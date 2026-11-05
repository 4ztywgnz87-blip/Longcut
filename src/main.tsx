import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.tsx';

// iOS bug: in a home-screen web app that draws under the status bar, 100% height is
// the screen minus the status bar, leaving an empty strip at the bottom. Use the
// real screen height there instead.
const standalone =
  (navigator as Navigator & { standalone?: boolean }).standalone === true ||
  matchMedia('(display-mode: standalone)').matches;
if (standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
  const fit = () => {
    const portrait = innerHeight >= innerWidth;
    const h = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    document.documentElement.style.setProperty('--app-h', `${h}px`);
  };
  fit();
  addEventListener('resize', fit);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
