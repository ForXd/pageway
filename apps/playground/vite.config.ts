import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        openai: fileURLToPath(new URL('./openai.html', import.meta.url)),
        webmcp: fileURLToPath(new URL('./webmcp.html', import.meta.url)),
      },
    },
  },
  server: {
    port: Number(process.env.PLAYGROUND_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api/openai':
        process.env.OPENAI_PROXY_TARGET ??
        process.env.AGENT_PROXY_TARGET ??
        'http://127.0.0.1:3001',
      '/api': process.env.AGENT_PROXY_TARGET ?? 'http://127.0.0.1:3001',
    },
  },
});
