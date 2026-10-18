import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { registerServiceWorker } from './services/appUpdate.ts';
import './index.css';
import { milestone } from './services/books/perf.ts';
import { applyFontPrefs } from './services/fontPrefs.ts';
import { applyThemeColor } from './services/themeColor.ts';

milestone('main-start');
applyThemeColor(); // the theme colour chosen in Profile > Appearance
applyFontPrefs(); // a font chosen in developer mode (nothing changes for everyone else)

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

// Offline + faster repeat visits (covers, dictionary, store data) and "new version" detection
registerServiceWorker();
