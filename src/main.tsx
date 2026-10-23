import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { registerServiceWorker, APP_BUILD } from './services/appUpdate.ts';
import { refreshDataForNewBuild } from './services/refreshApp.ts';
import './index.css';
import { milestone } from './services/books/perf.ts';
import { applyFontPrefs } from './services/fontPrefs.ts';

milestone('main-start');
refreshDataForNewBuild(APP_BUILD); // a new build forgets what the old one downloaded, once, before anything reads it
applyFontPrefs(); // a font chosen in developer mode (nothing changes for everyone else)

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

// Offline + faster repeat visits (covers, dictionary, store data) and "new version" detection
registerServiceWorker();
