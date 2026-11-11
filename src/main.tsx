import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are bundled with the app (no extra trip to Google Fonts before the first screen).
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/barlow-condensed/latin-900-italic.css';
import './styles.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Keep the app on the phone: later starts load from the device and work offline
// (saved routes can still be sent to the watch without a connection).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./sw.js');
      const reg = await navigator.serviceWorker.ready;
      // hand over the files this visit already loaded (see sw.js), once things have settled
      setTimeout(() => {
        const urls = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith(location.origin));
        reg.active?.postMessage({ type: 'keep', urls });
      }, 2500);
    } catch {
      /* the app works without it */
    }
  });
}
