import express from 'express';
import { fileURLToPath } from 'node:url';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { accountRoutes } from './accounts.js';

export function createApp({ pool, secret = process.env.SESSION_SECRET } = {}) {
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
    res.set('Cache-Control', 'no-store').json({ status: 'ok', stage: 2 });
  });
  if (pool) {
    if (!secret || secret.length < 32) throw new Error('SESSION_SECRET en az 32 karakter olmalı.');
    const production = process.env.NODE_ENV === 'production';
    if (production) app.set('trust proxy', 1);
    app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    app.use('/api', (req, res, next) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.get('origin');
        if (req.get('sec-fetch-site') === 'cross-site' || (origin && origin !== `${req.protocol}://${req.get('host')}`)) {
          return res.status(403).json({ error: 'İstek kaynağı reddedildi.' });
        }
        if (!req.is('application/json')) return res.status(415).json({ error: 'JSON içerik gerekli.' });
      }
      next();
    });
    app.use(express.json({ limit: '8kb' }));
    const Store = connectPgSimple(session);
    app.use(session({
      name: 'messaging.sid', secret, resave: false, saveUninitialized: false,
      store: new Store({ pool, tableName: 'sessions', createTableIfMissing: false, errorLog: () => {} }),
      cookie: { httpOnly: true, sameSite: 'lax', secure: production, maxAge: 8 * 60 * 60 * 1000 },
    }));
    app.use('/api', accountRoutes(pool));
  }
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
  app.use((_req, res) => res.status(404).json({ error: 'Kaynak bulunamadı.' }));
  app.use((_error, _req, res, _next) => {
    const status = _error.type === 'entity.too.large' ? 413 : _error.type === 'entity.parse.failed' ? 400 : 503;
    res.status(status).json({ error: status === 503 ? 'İşlem tamamlanamadı. Veritabanı bağlantısını kontrol edip yeniden deneyin.' : 'Geçersiz istek gövdesi.' });
  });
  return app;
}
