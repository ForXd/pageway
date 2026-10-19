import { createAgentHandler, type AgentOptions } from '@zllling/pageway-agent';
import { encodeSSE, EventType, type PageContext } from '@zllling/pageway-protocol';
import {
  PagewayProvider,
  PagewayChat,
  PagewayOverlay,
  ActionTimeline,
  usePageTool,
  usePageContext,
  usePageway,
} from '@zllling/pageway-react';

const options: AgentOptions = { mode: 'demo' };
const handler: (request: Request) => Promise<Response> = createAgentHandler(options);
const context: PageContext = { id: 'consumer', title: 'Consumer', data: { count: 0 } };
function Tools() {
  usePageContext(context);
  usePageTool<{ value: string }>({
    name: 'echo',
    description: 'Echo',
    parameters: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    },
    execute: ({ value }) => value,
  });
  const agent = usePageway();
  return (
    <button type="button" onClick={() => void agent.sendMessage('Hello')}>
      {agent.status}
    </button>
  );
}
const app = (
  <PagewayProvider endpoint="/api/agent" fetch={globalThis.fetch}>
    <Tools />
    <PagewayChat />
    <PagewayOverlay />
    <ActionTimeline />
  </PagewayProvider>
);
void [
  handler,
  app,
  encodeSSE({ type: EventType.RUN_FINISHED, runId: 'run', threadId: 'consumer' }),
];
