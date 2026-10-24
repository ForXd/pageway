import {
  createAgentHandler,
  createOpenAIProxyHandler,
  type AgentOptions,
} from '@zllling/pageway-agent';
import { encodeSSE, EventType, type PageContext } from '@zllling/pageway-protocol';
import {
  PagewayProvider,
  PagewayChat,
  PagewayOverlay,
  ActionTimeline,
  usePageTool,
  usePageContext,
  usePageway,
  type PageToolApproval,
  type PagewayActionSource,
  type PendingApproval,
} from '@zllling/pageway-react';

const options: AgentOptions = { mode: 'demo' };
const handler: (request: Request) => Promise<Response> = createAgentHandler(options);
const context: PageContext = { id: 'consumer', title: 'Consumer', data: { count: 0 } };
const approval: PageToolApproval = {
  title: 'Echo this value?',
  description: 'Review this value before returning it to the agent.',
};
const allowedSources: PagewayActionSource[] = ['chat', 'webmcp'];
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
    enabled: true,
    allowedSources,
    approval: ({ value }) => (value === 'review' ? approval : false),
    execute: ({ value }) => value,
  });
  const agent = usePageway();
  const pending: PendingApproval | null = agent.pendingApproval;
  const approve: (id: string) => boolean = agent.approveAction;
  const reject: (id: string) => boolean = agent.rejectAction;
  return (
    <>
      <button type="button" onClick={() => void agent.sendMessage('Hello')}>
        {agent.status}
      </button>
      {pending && (
        <section aria-label={pending.title}>
          <p>
            {pending.description} ({pending.source})
          </p>
          <button type="button" onClick={() => approve(pending.id)}>
            Approve
          </button>
          <button type="button" onClick={() => reject(pending.id)}>
            Reject
          </button>
        </section>
      )}
    </>
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
const proxy = createOpenAIProxyHandler({
  baseURL: 'https://model.example/v1',
  allowedModels: ['example'],
});
const direct = (
  <PagewayProvider
    apiOrigin="/api/openai"
    model="example"
    apiPath="chat/completions"
    storageKey="pageway:user:workspace"
    webmcp={{ prefix: 'workspace_' }}
  >
    <Tools />
    <PagewayChat />
    <PagewayOverlay />
  </PagewayProvider>
);
const webmcpOnly = (
  <PagewayProvider>
    <Tools />
    <PagewayOverlay />
  </PagewayProvider>
);
void [
  proxy,
  direct,
  webmcpOnly,
  handler,
  app,
  encodeSSE({ type: EventType.RUN_FINISHED, runId: 'run', threadId: 'consumer' }),
];
