import { useEffect, useState } from 'react';
import { usePageway } from '@zllling/pageway-react';
import App from '../../playground/src/App';
import { anonymousModelFetch, FREE_MODEL, FREE_MODEL_API_ORIGIN } from './free-model';
import { createBrowserDemoTransport } from './transport';

type Mode = 'free' | 'local';
const readMode = (): Mode =>
  new URLSearchParams(window.location.search).get('mode') === 'local' ? 'local' : 'free';
const endpoint = new URL('./local-agent', window.location.href);
const localTransport = createBrowserDemoTransport(endpoint);

function DemoNotice({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const agent = usePageway();
  const busy = agent.status === 'running';
  return (
    <section className="demo-mode" aria-label="Demo mode">
      <div className="demo-mode-heading">
        <span className="demo-mode-label">PAGEWAY / 在线体验</span>
        <fieldset className="demo-mode-switch" aria-label="选择演示模式">
          <button
            type="button"
            aria-pressed={mode === 'free'}
            disabled={busy}
            onClick={() => onChange('free')}
          >
            免费模型
          </button>
          <button
            type="button"
            aria-pressed={mode === 'local'}
            disabled={busy}
            onClick={() => onChange('local')}
          >
            本地演示
          </button>
        </fieldset>
      </div>
      <strong>{mode === 'free' ? '让真实模型操作这个页面。' : '在浏览器里，体验每一步。'}</strong>
      {mode === 'free' ? (
        <p>
          无需登录或 API Key。发送消息后，对话与演示看板数据将发送至{' '}
          <a href="https://text.pollinations.ai/models" target="_blank" rel="noreferrer">
            Pollinations · GPT-OSS
          </a>
          ，请勿输入敏感信息。匿名额度约每 30
          秒一次请求，一次操作可能需要多轮等待；也可切换本地演示。
        </p>
      ) : (
        <p>确定性规则驱动，不连接大模型、不上传输入。切换模式或刷新会重置对话与演示看板。</p>
      )}
      {mode === 'free' && <small>模型：{FREE_MODEL} · 切换模式或刷新会重置对话与看板</small>}
      {mode === 'free' && busy && (
        <p className="demo-model-status" role="status">
          正在等待模型并执行页面任务；可使用 Stop task 或 Esc 结束。
        </p>
      )}
      {mode === 'free' && agent.error && (
        <p className="demo-model-error" role="status">
          免费服务暂时不可用。请稍后重试，或点击“本地演示”体验页面操作；当前不会自动切换模式。
        </p>
      )}
    </section>
  );
}

export default function Demo() {
  const [mode, setMode] = useState<Mode>(readMode);
  useEffect(() => {
    const onPopState = () => setMode(readMode());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  function changeMode(next: Mode) {
    if (next === mode) return;
    const url = new URL(window.location.href);
    if (next === 'local') url.searchParams.set('mode', 'local');
    else url.searchParams.delete('mode');
    window.history.replaceState(null, '', url);
    setMode(next);
  }
  const transport =
    mode === 'free'
      ? { apiOrigin: FREE_MODEL_API_ORIGIN, model: FREE_MODEL, fetch: anonymousModelFetch }
      : { endpoint: endpoint.href, fetch: localTransport, browserDemo: true };
  return (
    <App key={mode} {...transport} demoNotice={<DemoNotice mode={mode} onChange={changeMode} />} />
  );
}
