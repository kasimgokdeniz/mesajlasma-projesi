import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createPool } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { createApp } from '../server/app.js';
import { isConversationMember } from '../server/access.js';

test('PostgreSQL üzerinde hesap, oturum, erişim ve üyelik kabul kontrolleri', async t => {
  // Guard runs before any database connection or cleanup.
  const pool = createPool({ test: true });
  const ids = [];
  let conversationId;
  t.after(async () => {
    if (conversationId) {
      await pool.query('DELETE FROM conversation_members WHERE conversation_id = $1', [conversationId]);
      await pool.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
    }
    for (const id of ids) {
      await pool.query("DELETE FROM sessions WHERE sess->>'userId' = $1", [id]);
      await pool.query('DELETE FROM users WHERE id = $1', [id]);
    }
    await pool.end();
  });
  await migrate(pool);
  await migrate(pool);
  const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  for (const name of ['users', 'conversations', 'conversation_members', 'messages', 'user_public_keys', 'key_envelopes', 'writing_profiles', 'sessions']) {
    assert.ok(tables.rows.some(row => row.tablename === name));
  }
  const server = createApp({ pool, secret: randomBytes(48).toString('hex') }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, cookie, headers = {}) => fetch(`${base}/api${path}`, {
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
  });
  const username = `test_${randomBytes(8).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  let user;
  let cookie;
  await t.test('Oturumsuz istekler reddedilir; hatalı girdiler ve çapraz kaynak reddedilir', async () => {
    for (const route of ['/users', '/auth/me']) assert.equal((await request(route)).status, 401);
    assert.equal((await request('/auth/logout', {})).status, 401);
    for (const body of [{}, { username: "a';--", password }, { username, password: 'short' }, { username: {}, password }]) {
      assert.equal((await request('/auth/register', body)).status, 400);
    }
    assert.equal((await request('/auth/register', { username, password }, null, { origin: 'https://other.example' })).status, 403);
    const malformed = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400);
  });
  await t.test('Kayıt, benzersizlik, güvenli parola ve çerez', async () => {
    const response = await request('/auth/register', { username, password });
    assert.equal(response.status, 201);
    user = (await response.json()).user;
    ids.push(user.id);
    const header = response.headers.get('set-cookie');
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Lax/i);
    cookie = header.split(';')[0];
    assert.deepEqual(Object.keys(user).sort(), ['id', 'username']);
    const row = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id])).rows[0];
    assert.match(row.password_hash, /^scrypt\$/);
    assert.ok(!row.password_hash.includes(password));
    assert.equal((await request('/auth/register', { username: username.toUpperCase(), password })).status, 409);
    const list = await request('/users', undefined, cookie);
    assert.equal(list.status, 200);
    for (const entry of (await list.json()).users) assert.deepEqual(Object.keys(entry).sort(), ['id', 'username']);
  });
  await t.test('Çıkış oturumu iptal eder, yanlış parola reddedilir, giriş oturumu yeniler', async () => {
    const oldCookie = cookie;
    assert.equal((await request('/auth/logout', {}, cookie)).status, 200);
    assert.equal((await request('/users', undefined, oldCookie)).status, 401);
    assert.equal((await request('/auth/login', { username, password: 'wrong-password-123' })).status, 401);
    assert.equal((await request('/auth/login', { username: 'not_found_account', password })).status, 401);
    const response = await request('/auth/login', { username, password });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
    assert.notEqual(cookie, oldCookie);
    assert.deepEqual((await (await request('/auth/me', undefined, cookie)).json()).user, user);
    const secondServer = createApp({ pool, secret: randomBytes(48).toString('hex') }).listen(0, '127.0.0.1');
    await once(secondServer, 'listening');
    try {
      const forged = await fetch(`http://127.0.0.1:${secondServer.address().port}/api/users`, { headers: { cookie } });
      assert.equal(forged.status, 401);
    } finally { await new Promise(resolve => secondServer.close(resolve)); }
  });
  await t.test('Üyelik yardımcısı üyeyi kabul eder, diğer kullanıcı ve hatalı kimliği reddeder', async () => {
    const row = await pool.query("INSERT INTO conversations(kind, created_by) VALUES ('private', $1) RETURNING id", [user.id]);
    conversationId = row.rows[0].id;
    await pool.query('INSERT INTO conversation_members(conversation_id, user_id) VALUES ($1, $2)', [conversationId, user.id]);
    assert.equal(await isConversationMember(pool, conversationId, user.id), true);
    assert.equal(await isConversationMember(pool, conversationId, '0'), false);
    assert.equal(await isConversationMember(pool, '1 OR 1=1', user.id), false);
    await request('/auth/logout', {}, cookie);
  });
});

test('Test bağlantısı uygulama veritabanını reddeder', () => {
  const old = process.env.TEST_PGDATABASE;
  try {
    process.env.TEST_PGDATABASE = process.env.PGDATABASE;
    assert.throws(() => createPool({ test: true }));
  } finally {
    if (old === undefined) delete process.env.TEST_PGDATABASE;
    else process.env.TEST_PGDATABASE = old;
  }
});
