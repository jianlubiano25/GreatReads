import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import http from 'http';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');

// Ensure dist exists before serving
if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.log('Production build not found in dist. Executing npm run build...');
  try {
    execSync('npm run build', { stdio: 'inherit', cwd: __dirname });
  } catch (err) {
    console.error('Failed to run build on startup:', err);
  }
}

const app = express();

// Health check endpoint for Cloud Run and Kubernetes deployment health checks
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// Cache control headers for static assets
app.use(
  express.static(distDir, {
    maxAge: '1d',
    setHeaders: (res, filePath) => {
      // Don't cache HTML, service worker, or manifest so updates are immediate
      if (
        filePath.endsWith('index.html') ||
        filePath.endsWith('sw.js') ||
        filePath.endsWith('manifest.json')
      ) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  })
);

// SPA client-side routing fallback
app.get('*', (_req, res) => {
  const indexHtml = path.join(distDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.status(503).send('Application build in progress. Please refresh shortly.');
  }
});

// Cloud Run specifies PORT (typically 8080). AI Studio dev container uses DEFAULT_APP_PORT (3000).
const primaryPort = parseInt(process.env.PORT || process.env.DEFAULT_APP_PORT || '3000', 10);

const server = http.createServer(app);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`Port ${primaryPort} is in use, trying next port...`);
    server.listen(primaryPort + 1, '0.0.0.0');
  } else {
    console.error('Server error:', err);
  }
});

server.listen(primaryPort, '0.0.0.0', () => {
  console.log(`Server successfully started and listening on 0.0.0.0:${primaryPort}`);
});
