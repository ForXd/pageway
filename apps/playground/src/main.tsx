import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@zllling/pageway-react/styles.css';
import './style.css';
const root = document.getElementById('root');
if (!root) throw new Error('The playground root element is missing.');
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App
      apiOrigin={import.meta.env.VITE_API_ORIGIN || undefined}
      model={import.meta.env.VITE_MODEL_NAME || undefined}
      storageKey={import.meta.env.VITE_STORAGE_KEY || undefined}
    />
  </React.StrictMode>,
);
