import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../playground/src/App';
import '@zllling/pageway-react/styles.css';
import '../../playground/src/style.css';
import { createBrowserDemoTransport } from './transport';

const root = document.getElementById('root');
if (!root) throw new Error('The demo root element is missing.');
// This address is handled entirely in-process. GitHub Pages needs no API server.
const endpoint = new URL('./local-agent', window.location.href);
const transport = createBrowserDemoTransport(endpoint);

createRoot(root).render(
  <StrictMode>
    <App endpoint={endpoint.href} fetch={transport} browserDemo />
  </StrictMode>,
);
