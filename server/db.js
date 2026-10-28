import pg from 'pg';

export function createPool({ test = false } = {}) {
  const database = test ? process.env.TEST_PGDATABASE : process.env.PGDATABASE;
  if (!database || (test && database === process.env.PGDATABASE)) {
    throw new Error('Ayrı veritabanı yapılandırması gerekli.');
  }
  return new pg.Pool({ database, connectionTimeoutMillis: 5000 });
}
