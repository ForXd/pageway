import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = [];
let stopping = false;

// Explicit values take precedence over process.loadEnvFile in the real server.
// No test can accidentally spend quota or use a developer's provider credential.
const env = {
  ...process.env,
  AGENT_MODE: 'openai',
  MODEL_BASE_URL: 'http://127.0.0.1:4182/v1',
  MODEL_API_PATH: 'chat/completions',
  MODEL_NAME: 'pageway-e2e-model',
  MODEL_API_KEY: '',
  AGENT_TIMEOUT_MS: '8000',
  HOST: '127.0.0.1',
  PORT: '4181',
  PLAYGROUND_PORT: '4180',
  AGENT_PROXY_TARGET: 'http://127.0.0.1:4181',
  OPENAI_PROXY_TARGET: 'http://127.0.0.1:4183',
  VITE_AGENT_ENDPOINT: '/api/agent',
  VITE_API_ORIGIN: '',
  VITE_MODEL_NAME: 'pageway-e2e-model',
  VITE_STORAGE_KEY: '',
  ALLOWED_ORIGINS: 'http://127.0.0.1:4180',
};

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 1500).unref();
  Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) =>
          child.exitCode !== null || child.signalCode !== null
            ? resolve()
            : child.once('exit', resolve),
        ),
    ),
  ).then(() => process.exit(code));
}

function run(args, overrides = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...env, ...overrides },
    stdio: 'inherit',
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(error);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stop(code || 1);
  });
}

// Run actual app entrypoints without watchers; child PIDs are owned and cleaned
// up by this process, including when a test run is interrupted.
run(['tests/e2e/model-server.mjs']);
run(['--import', 'tsx', '--conditions=development', 'apps/server/src/index.ts']);
run(['--import', 'tsx', '--conditions=development', 'apps/server/src/index.ts'], {
  AGENT_MODE: 'proxy',
  PORT: '4183',
});
run([
  'apps/playground/node_modules/vite/bin/vite.js',
  '--host',
  '127.0.0.1',
  '--config',
  'apps/playground/vite.config.ts',
  'apps/playground',
]);
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
