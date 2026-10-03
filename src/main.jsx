import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { recordInvalid } from './lib/invalidLog';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  // F-16: Service Worker が受け付けなかったメッセージを集約先に残す
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'SW_INVALID') {
      recordInvalid({ kind: e.data.kind, stage: e.data.stage, raw: e.data.raw, reason: e.data.reason });
    }
  });
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL });
}
