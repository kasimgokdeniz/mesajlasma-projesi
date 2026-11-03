import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.js';

test('Sunucu HTTP üzerinden ana sayfa, varlıklar ve durum yanıtı sunar', async (t) => {
  const server = createApp().listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Giriş ve kayıt/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  for (const path of ['/app.js', '/styles.css']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).length > 0);
  }
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', stage: 3 });
  for (const path of ['/missing', '/.env', '/server/app.js', '/package.json']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Kaynak bulunamadı.' });
  }
});
