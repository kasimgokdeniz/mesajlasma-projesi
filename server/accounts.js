import { Router } from 'express';
import { hashPassword, verifyPassword } from './passwords.js';
import { requireAuth } from './access.js';

export function accountRoutes(pool) {
  const router = Router();
  const dummyHash = hashPassword('dummy-password-for-timing');
  const establish = async (req, id) => {
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = id;
    await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
  };
  for (const action of ['register', 'login']) {
    router.post(`/auth/${action}`, async (req, res) => {
      const { username, password } = req.body ?? {};
      if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(username) ||
          typeof password !== 'string' || password.length < 12 || password.length > 128) {
        return res.status(400).json({ error: 'Kullanıcı adı 3–32 harf, rakam veya alt çizgi; parola 12–128 karakter olmalı.' });
      }
      const normalized = username.toLowerCase();
      if (action === 'register') {
        const hash = await hashPassword(password);
        const result = await pool.query('INSERT INTO users(username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING RETURNING id, username', [normalized, hash]);
        if (!result.rowCount) return res.status(409).json({ error: 'Bu kullanıcı adı kullanılıyor.' });
        await establish(req, result.rows[0].id);
        return res.status(201).json({ user: result.rows[0] });
      }
      const result = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [normalized]);
      const user = result.rows[0];
      const valid = await verifyPassword(password, user?.password_hash ?? await dummyHash);
      if (!user || !valid) return res.status(401).json({ error: 'Kullanıcı adı veya parola hatalı.' });
      await establish(req, user.id);
      return res.json({ user: { id: user.id, username: user.username } });
    });
  }
  router.post('/auth/logout', requireAuth, async (req, res) => {
    await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    res.clearCookie('messaging.sid', { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.json({ success: true });
  });
  router.get('/auth/me', requireAuth, async (req, res) => {
    const result = await pool.query('SELECT id, username FROM users WHERE id = $1', [req.session.userId]);
    if (!result.rowCount) return res.status(401).json({ error: 'Oturum geçersiz.' });
    res.json({ user: result.rows[0] });
  });
  router.get('/users', requireAuth, async (req, res) => {
    const result = await pool.query('SELECT id, username FROM users WHERE id <> $1 ORDER BY username', [req.session.userId]);
    res.json({ users: result.rows });
  });
  return router;
}
