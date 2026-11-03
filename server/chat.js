import { Router } from 'express';
import { requireAuth, isConversationMember } from './access.js';
export class ChatError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function id(value) { if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) throw new ChatError('Geçersiz kimlik.'); return value; }
export async function member(pool, conversationId, userId) { id(conversationId); if (!await isConversationMember(pool, conversationId, userId)) throw new ChatError('Bu sohbete erişiminiz yok.', 403); }
export async function createConversation(pool, userId, body) {
  if (!body || !['private', 'group'].includes(body.kind)) throw new ChatError('Geçersiz sohbet türü.');
  let members, name = null, pair = null;
  if (body.kind === 'private') { const other = id(body.userId); if (other === userId) throw new ChatError('Başka bir kullanıcı seçin.'); members = [userId, other]; pair = members.slice().sort((a,b) => BigInt(a) < BigInt(b) ? -1 : 1).join(':'); }
  else { if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100 || !Array.isArray(body.memberIds) || body.memberIds.length > 99) throw new ChatError('Grup adı 1–100 karakter, grup en fazla 100 üye olmalı.'); members = [...new Set([userId, ...body.memberIds.map(id)])]; if (members.length < 3) throw new ChatError('En az iki başka kullanıcı seçin.'); name = body.name.trim(); }
  const client = await pool.connect();
  try { await client.query('BEGIN');
    if ((await client.query('SELECT id FROM users WHERE id = ANY($1::bigint[])', [members])).rowCount !== members.length) throw new ChatError('Kullanıcı bulunamadı.');
    const result = await client.query('INSERT INTO conversations(kind,name,created_by,private_pair) VALUES ($1,$2,$3,$4) ON CONFLICT(private_pair) DO UPDATE SET private_pair=EXCLUDED.private_pair RETURNING id', [body.kind,name,userId,pair]);
    const conversationId = result.rows[0].id;
    await client.query('INSERT INTO conversation_members(conversation_id,user_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING', [conversationId,members]);
    await client.query('COMMIT'); return { id: conversationId };
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
export async function history(pool, userId, conversationId, before) {
  await member(pool, conversationId, userId); if (before !== undefined) id(before);
  const rows = (await pool.query(`SELECT m.id,m.conversation_id,m.sender_id,u.username,m.content,m.created_at,m.client_id FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=$1 AND ($2::bigint IS NULL OR m.id<$2) ORDER BY m.id DESC LIMIT 51`, [conversationId,before ?? null])).rows;
  const hasMore = rows.length > 50; const messages = rows.slice(0,50).reverse(); return { messages, nextBefore: hasMore ? messages[0].id : null };
}
export async function saveMessage(pool, userId, body) {
  if (!body || typeof body.content !== 'string' || !body.content.trim() || body.content.length > 1000 || typeof body.clientId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientId)) throw new ChatError('Mesaj 1–1000 karakter ve geçerli gönderim kimliği içermeli.');
  await member(pool,body.conversationId,userId);
  const result = await pool.query(`INSERT INTO messages(conversation_id,sender_id,content,client_id) VALUES ($1,$2,$3,$4) ON CONFLICT(sender_id,client_id) DO UPDATE SET client_id=messages.client_id RETURNING id,conversation_id,sender_id,content,created_at,client_id`, [body.conversationId,userId,body.content,body.clientId]);
  const message = result.rows[0]; if (message.conversation_id !== body.conversationId || message.content !== body.content) throw new ChatError('Gönderim kimliği başka mesajda kullanılmış.');
  message.username = (await pool.query('SELECT username FROM users WHERE id=$1',[userId])).rows[0].username; return message;
}
export function chatRoutes(pool) {
 const router = Router(); router.use(requireAuth);
 const wrap = fn => async (req,res,next) => { try { await fn(req,res); } catch(e) { if (e instanceof ChatError) res.status(e.status).json({error:e.message}); else next(e); } };
 router.get('/conversations', wrap(async(req,res) => res.json({conversations:(await pool.query(`SELECT c.id,c.kind,c.name, (SELECT string_agg(u.username, ', ' ORDER BY u.username) FROM conversation_members cm JOIN users u ON u.id=cm.user_id WHERE cm.conversation_id=c.id) AS members FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE cm.user_id=$1 ORDER BY c.id DESC`,[req.session.userId])).rows})));
 router.post('/conversations',wrap(async(req,res) => res.status(201).json(await createConversation(pool,req.session.userId,req.body))));
 router.get('/conversations/:id/messages',wrap(async(req,res) => res.json(await history(pool,req.session.userId,req.params.id,req.query.before))));
 return router;
}
