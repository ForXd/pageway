import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { output, packPackages, root, run } from './release.mjs';

export async function verifyPacked() {
  const packed = await packPackages();
  const consumer = await mkdtemp(join(tmpdir(), 'pageway-consumer-'));
  try {
    const requireApp = createRequire(join(root, 'apps/playground/package.json'));
    const installedVersion = async (name) =>
      JSON.parse(await readFile(requireApp.resolve(`${name}/package.json`), 'utf8')).version;
    const dependencies = Object.fromEntries(
      packed.map((entry) => [
        entry.name,
        `file:${join(output, entry.filename).replaceAll('\\', '/')}`,
      ]),
    );
    for (const name of ['react', 'react-dom', '@types/react', '@types/react-dom'])
      dependencies[name] = await installedVersion(name);
    await writeFile(
      join(consumer, 'package.json'),
      JSON.stringify({ private: true, type: 'module', dependencies }, null, 2),
    );
    // All Pageway packages are direct file dependencies: unpublished workspace
    // versions are resolved together from these tarballs, never from the registry.
    run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        '--registry',
        'https://registry.npmjs.org',
      ],
      consumer,
    );
    await writeFile(
      join(consumer, 'check.mjs'),
      `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { EventType, encodeSSE, readAgentEvents } from '@zllling/pageway-protocol';
import { createAgentHandler } from '@zllling/pageway-agent';
import { PagewayProvider, PagewayChat, PagewayOverlay } from '@zllling/pageway-react';
assert(encodeSSE({ type: EventType.RUN_FINISHED, runId: 'run', threadId: 'thread' }).startsWith('data:'));
for (const name of ${JSON.stringify(packed.map((entry) => entry.name))}) assert(import.meta.resolve(name).includes('/dist/'));
assert((await readFile(new URL(import.meta.resolve('@zllling/pageway-react/styles.css')), 'utf8')).includes('.pw-'));
const html = renderToString(createElement(PagewayProvider, { endpoint: '/api/agent' }, createElement(PagewayChat), createElement(PagewayOverlay)));
assert(html.includes('Pageway'));
const request = new Request('http://localhost/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId: 'consumer', runId: 'run', messages: [{ id: 'message', role: 'user', content: 'Hello' }], tools: [], context: [], state: {}, forwardedProps: {} }) });
const response = await createAgentHandler({ mode: 'demo' })(request);
assert.equal(response.status, 200);
const events = [];
for await (const event of readAgentEvents(response.body)) events.push(event.type);
assert(events.includes(EventType.RUN_STARTED) && events.includes(EventType.RUN_FINISHED));
console.log('Packed runtime, CSS, SSR and HTTP consumer checks passed.');
`,
    );
    await writeFile(
      join(consumer, 'check.tsx'),
      `
import { createAgentHandler, type AgentOptions } from '@zllling/pageway-agent';
import { encodeSSE, EventType, type PageContext } from '@zllling/pageway-protocol';
import { PagewayProvider, PagewayChat, PagewayOverlay, usePageTool, usePageContext, usePageway } from '@zllling/pageway-react';
const options: AgentOptions = { mode: 'demo' };
const handler: (request: Request) => Promise<Response> = createAgentHandler(options);
const context: PageContext = { id: 'consumer', title: 'Consumer', data: { count: 0 } };
function Tools() {
  usePageContext(context);
  usePageTool<{ value: string }>({ name: 'echo', description: 'Echo', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }, execute: ({ value }) => value });
  const agent = usePageway();
  return <button onClick={() => void agent.sendMessage('Hello')}>{agent.status}</button>;
}
const app = <PagewayProvider endpoint='/api/agent'><Tools /><PagewayChat /><PagewayOverlay /></PagewayProvider>;
void [handler, app, encodeSSE({ type: EventType.RUN_FINISHED, runId: 'run', threadId: 'consumer' })];
`,
    );
    run(process.execPath, ['--conditions=development', 'check.mjs'], consumer);
    const compiler = join(
      dirname(createRequire(join(root, 'package.json')).resolve('typescript/package.json')),
      'bin',
      'tsc',
    );
    run(
      process.execPath,
      [
        compiler,
        '--noEmit',
        '--strict',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--target',
        'ES2022',
        '--lib',
        'ES2022,DOM,DOM.Iterable',
        '--jsx',
        'react-jsx',
        '--skipLibCheck',
        'false',
        'check.tsx',
      ],
      consumer,
    );
    console.log(
      `Verified ${packed.length} published packages in an isolated consumer. Tarballs: ${output}`,
    );
    return packed;
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyPacked().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
