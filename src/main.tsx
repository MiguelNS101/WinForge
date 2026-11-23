import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { MouseOverlay } from './components/MouseOverlay.tsx';
import { OcrOverlay } from './components/OcrOverlay.tsx';
import './index.css';

const overlayMode = new URLSearchParams(window.location.search).get('overlay');

if (overlayMode === 'ocr' || overlayMode === 'mouse') {
  document.documentElement.classList.add('overlay-mode');
}

const rootEl = document.getElementById('root')!;
createRoot(rootEl).render(
  overlayMode === 'ocr' ? (
    <OcrOverlay />
  ) : overlayMode === 'mouse' ? (
    <MouseOverlay />
  ) : (
    <App />
  )
);
