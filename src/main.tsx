import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { registerServiceWorker, APP_BUILD } from './services/appUpdate.ts';
import { refreshDataForNewBuild } from './services/refreshApp.ts';
import './index.css';
import { milestone } from './services/books/perf.ts';
import { applyFontPrefs } from './services/fontPrefs.ts';
import { restoreDurableCopies } from './services/durableCopy.ts';
import { KEEP_ACROSS_BUILDS } from './services/books/cache.ts';

milestone('main-start');
applyFontPrefs(); // a font chosen in developer mode (nothing changes for everyone else)

// If the browser dropped the saved shelf lists / reset marks / shelf covers, put them back from the IndexedDB safety copy BEFORE anything reads them
// (nothing is awaited when they are all there; at most 1.5 s otherwise). Then a new build refreshes what it should (not those, see KEEP_ACROSS_BUILDS).
void restoreDurableCopies(KEEP_ACROSS_BUILDS).catch(() => []).then(() => {
  refreshDataForNewBuild(APP_BUILD); // clears old downloads only when DATA_EPOCH changed (once), never on every update // a new build forgets what the old one downloaded, once, before anything reads it
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
});

// Offline + faster repeat visits (covers, dictionary, store data) and "new version" detection
registerServiceWorker();
