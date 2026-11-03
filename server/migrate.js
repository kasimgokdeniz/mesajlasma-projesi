import { readFile } from 'node:fs/promises';
import { createPool } from './db.js';

export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(926421)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)');
    for (const [version, file] of [[1, '001_accounts.sql'], [2, '002_chat.sql']]) {
      const applied = await client.query('SELECT version FROM schema_migrations WHERE version = $1', [version]);
      if (!applied.rowCount) {
        await client.query(await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8'));
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

if (process.argv[1]?.endsWith('migrate.js')) {
  const pool = createPool({ test: process.argv.includes('--test') });
  try { await migrate(pool); console.log('Migration tamamlandı.'); }
  catch { console.error('Migration başarısız. Veritabanı bağlantısını ve şema yetkilerini kontrol edin.'); process.exitCode = 1; }
  finally { await pool.end(); }
}
