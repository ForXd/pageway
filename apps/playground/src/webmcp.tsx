import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@zllling/pageway-react/styles.css';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('The playground root element is missing.');
createRoot(root).render(
  <StrictMode>
    <App webmcpOnly />
  </StrictMode>,
);
