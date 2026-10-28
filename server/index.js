import { createApp } from './app.js';
import { createPool } from './db.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT, 1 ile 65535 arasında bir tam sayı olmalı.');
  process.exit(1);
}
const pool = createPool();
const server = createApp({ pool }).listen(port, host, () => {
  console.log(`Uygulama hazır: http://${host}:${port} (aşama 2)`);
});
server.on('error', () => {
  console.error('Sunucu başlatılamadı. HOST, PORT ve port kullanımını kontrol edin.');
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => pool.end()));
}
