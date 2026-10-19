import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../playground/src/App';
import '@zllling/pageway-react/styles.css';
import '../../playground/src/style.css';

const root = document.getElementById('root');
if (!root) throw new Error('The WebMCP workspace root is missing.');
createRoot(root).render(
  <StrictMode>
    <App webmcpOnly />
  </StrictMode>,
);
