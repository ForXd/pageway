import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createOpenAIProxyHandler } from '../packages/agent/src/index.js';
import { PagewayEngine } from '../packages/react/src/engine.js';

// Deliberately never load .env or read model credentials. This opt-in smoke check
// uses one anonymous, zero-price model and sends only synthetic application data.
const model = 'nvidia/nemotron-3.5-lightning:free';
const baseURL = 'https://ai-gateway.kilo.ai/api/v1';
const catalog = await fetch(`${baseURL}/models`, { signal: AbortSignal.timeout(20_000) });
assert(catalog.ok, 'Unable to verify the current free model catalog.');
const listing = (await catalog.json()) as {
  data?: { id: string; isFree?: boolean; pricing?: { prompt: string; completion: string } }[];
};
const entry = listing.data?.find((candidate) => candidate.id === model);
assert(
  entry?.isFree && Number(entry.pricing?.prompt) === 0 && Number(entry.pricing?.completion) === 0,
  'Model is not currently listed as free.',
);
let requests = 0;
let standardRequests = 0;
let status = 'todo';
let receipt = '';
const handler = createOpenAIProxyHandler({
  baseURL,
  allowedModels: [model],
  timeoutMs: 180_000,
  fetch: async (url, init) => {
    assert(++requests <= 3, 'Smoke check exceeded the three-request limit.');
    assert(
      !new Headers(init?.headers).has('authorization'),
      'Anonymous checks must never send credentials.',
    );
    console.log(`Anonymous free completion ${requests}`);
    return fetch(url, init);
  },
});
const server = createServer(async (incoming, outgoing) => {
  const controller = new AbortController();
  outgoing.on('close', () => {
    if (!outgoing.writableEnded) controller.abort();
  });
  try {
    assert.equal(incoming.url, '/v1/chat/completions');
    const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      duplex: 'half',
      signal: controller.signal,
    };
    const response = await handler(new Request('http://localhost/v1/chat/completions', init));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) return outgoing.end();
    const stream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
    stream.on('error', () => outgoing.destroy());
    stream.pipe(outgoing);
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const engine = new PagewayEngine({
  apiOrigin: `http://127.0.0.1:${address.port}/v1`,
  model,
  timeoutMs: 180_000,
  getContexts: () => [
    {
      id: 'synthetic',
      title: 'Synthetic smoke workspace',
      data: { item: { id: 'test-item', status } },
    },
  ],
  getTools: () => [
    {
      name: 'complete_item',
      description: 'Mark test-item as done and return its execution receipt.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', enum: ['test-item'] } },
        required: ['id'],
        additionalProperties: false,
      },
      execute: () => {
        status = 'done';
        receipt = `PAGEWAY-${crypto.randomUUID()}`;
        return { id: 'test-item', status, receipt };
      },
    },
  ],
  fetch: async (url, init) => {
    const body = JSON.parse(String(init?.body));
    assert(
      body.model === model && body.stream === true && !('threadId' in body),
      'Frontend must send standard OpenAI requests.',
    );
    if (++standardRequests > 1) {
      assert(
        body.messages.some(
          (message: { role: string; content?: string }) =>
            message.role === 'tool' && message.content?.includes(receipt),
        ),
        'Tool result was not returned to the model.',
      );
    }
    return fetch(url, init);
  },
});
try {
  await engine.sendMessage(
    'Use complete_item to mark test-item done. After it executes, return the exact receipt from the tool result and the latest status. Do not invent a receipt.',
  );
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.error, null);
  assert.equal(status, 'done');
  assert.equal(snapshot.actions.length, 1);
  assert.equal(snapshot.actions[0]?.status, 'success');
  assert(
    snapshot.messages.at(-1)?.content?.includes(receipt),
    'Final response did not contain the tool-only receipt.',
  );
  assert.equal(standardRequests, requests);
  console.log(
    JSON.stringify({
      result: 'PASS',
      model,
      requests,
      standardRequests,
      status,
      receipt,
      reply: snapshot.messages.at(-1)?.content,
    }),
  );
} finally {
  engine.stop();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
