import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Demo from './Demo';
import '@zllling/pageway-react/styles.css';
import '../../playground/src/style.css';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('The demo root element is missing.');

createRoot(root).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
