import express from 'express';
import { fileURLToPath } from 'node:url';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });
  app.get('/api/health', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok', stage: 1 });
  });
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
  app.use((_req, res) => res.status(404).json({ error: 'Kaynak bulunamadı.' }));
  app.use((_error, _req, res, _next) => {
    res.status(500).json({ error: 'Sunucu isteği işleyemedi.' });
  });
  return app;
}
