import { createPublicKey } from 'node:crypto';
import { ChatError, member } from './chat.js';

export function validatePublicKey(key) {
  if (!key || Object.keys(key).sort().join(',') !== 'e,kty,n' || key.kty !== 'RSA' || key.e !== 'AQAB' || !/^[A-Za-z0-9_-]{342}$/.test(key.n)) throw new ChatError('Geçersiz açık anahtar.');
  try {
    if (createPublicKey({ key, format: 'jwk' }).asymmetricKeyDetails.modulusLength !== 2048) throw new Error();
  } catch { throw new ChatError('Geçersiz açık anahtar.'); }
  return key;
}
export async function ownKey(pool, userId) {
  return (await pool.query('SELECT user_id,key_version,public_key FROM user_public_keys WHERE user_id=$1 ORDER BY key_version DESC LIMIT 1', [userId])).rows[0] ?? null;
}
export async function publishKey(pool, userId, body) {
  if (!body || Object.keys(body).sort().join(',') !== 'expectedVersion,publicKey,userId' || body.userId!==userId) throw new ChatError('Açık anahtar, beklenen sürüm ve oturum hesabı eşleşmeli.');
  const key = validatePublicKey(body?.publicKey);
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) throw new ChatError('Geçersiz anahtar sürümü.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const previous = await ownKey(client, userId);
    if ((previous?.key_version ?? 0) !== body.expectedVersion) throw new ChatError('Anahtar değişti. Sayfayı yenileyin.', 409);
    const result = await client.query('INSERT INTO user_public_keys(user_id,key_version,public_key) VALUES ($1,$2,$3) RETURNING user_id,key_version,public_key', [userId, body.expectedVersion + 1, key]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
export async function conversationKeys(pool, userId, conversationId) {
  await member(pool, conversationId, userId);
  return (await pool.query(`SELECT cm.user_id,u.username,k.key_version,k.public_key FROM conversation_members cm JOIN users u ON u.id=cm.user_id LEFT JOIN LATERAL (SELECT key_version,public_key FROM user_public_keys WHERE user_id=cm.user_id ORDER BY key_version DESC LIMIT 1) k ON true WHERE cm.conversation_id=$1 ORDER BY cm.user_id`, [conversationId])).rows;
}
