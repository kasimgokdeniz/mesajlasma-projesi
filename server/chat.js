import { Router } from 'express';
import { requireAuth, isConversationMember } from './access.js';
import { ownKey, publishKey, conversationKeys } from './keys.js';
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
  const rows = (await pool.query(`SELECT m.id,m.conversation_id,m.sender_id,u.username,m.content,m.encrypted_content,m.created_at,m.client_id FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=$1 AND ($2::bigint IS NULL OR m.id<$2) ORDER BY m.id DESC LIMIT 51`, [conversationId,before ?? null])).rows;
  const hasMore = rows.length > 50; const messages = rows.slice(0,50).reverse(); return { messages, nextBefore: hasMore ? messages[0].id : null };
}
export async function saveMessage(pool, userId, body) {
  if (!body || Object.keys(body).sort().join(',')!=='clientId,conversationId,packet' || typeof body.clientId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientId)) throw new ChatError('Yalnızca şifreli mesaj ve geçerli gönderim kimliği kabul edilir.');
  await member(pool,body.conversationId,userId);
  const packet=body.packet;
  const exact=(o,keys)=>o && typeof o==='object' && !Array.isArray(o) && Object.keys(o).sort().join(',')===keys;
  const base64=(s,min,max)=>typeof s==='string' && s.length%4===0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s) && Buffer.from(s,'base64').toString('base64')===s && Buffer.from(s,'base64').length>=min && Buffer.from(s,'base64').length<=max;
  if (!exact(packet,'ciphertext,envelopes,iv,v') || packet.v!==1 || !base64(packet.iv,12,12) || !base64(packet.ciphertext,17,4016) || !Array.isArray(packet.envelopes) || packet.envelopes.length<2 || packet.envelopes.length>100 || Buffer.byteLength(JSON.stringify(body))>65536) throw new ChatError('Geçersiz şifreli mesaj paketi.');
  for(const e of packet.envelopes) if(!exact(e,'keyVersion,userId,wrapped') || !Number.isSafeInteger(e.keyVersion) || e.keyVersion<1 || !base64(e.wrapped,256,256)) throw new ChatError('Geçersiz anahtar zarfı.'); else id(e.userId);
  // An exact retry remains valid after key rotation, but never alters its packet.
  const existing=(await pool.query('SELECT m.*,u.username FROM messages m JOIN users u ON u.id=m.sender_id WHERE sender_id=$1 AND client_id=$2',[userId,body.clientId])).rows[0];
  const same=p=>JSON.stringify(canonical(p))===JSON.stringify(canonical(packet));
  if(existing){if(existing.conversation_id!==body.conversationId || !same(existing.encrypted_content)) throw new ChatError('Gönderim kimliği başka mesajda kullanılmış.'); return publicMessage(existing);}
  const keys=await conversationKeys(pool,userId,body.conversationId);
  if(new Set(packet.envelopes.map(e=>e.userId)).size!==keys.length || packet.envelopes.length!==keys.length || keys.some(k=>!k.key_version || !packet.envelopes.some(e=>e.userId===k.user_id && e.keyVersion===k.key_version))) throw new ChatError('Üyelerin anahtarları eksik veya değişti. Anahtarları yeniden doğrulayın.');
  const result = await pool.query(`INSERT INTO messages(conversation_id,sender_id,encrypted_content,key_version,client_id) VALUES ($1,$2,$3,1,$4) ON CONFLICT(sender_id,client_id) DO UPDATE SET client_id=messages.client_id RETURNING id,conversation_id,sender_id,encrypted_content,created_at,client_id`, [body.conversationId,userId,packet,body.clientId]);
  const message = result.rows[0]; if (message.conversation_id !== body.conversationId || !same(message.encrypted_content)) throw new ChatError('Gönderim kimliği başka mesajda kullanılmış.');
  message.username = (await pool.query('SELECT username FROM users WHERE id=$1',[userId])).rows[0].username; return message;
}
function canonical(value) { if(Array.isArray(value)) return value.map(canonical); if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])); return value; }
function publicMessage(m) { return Object.fromEntries(['id','conversation_id','sender_id','encrypted_content','created_at','client_id','username'].map(k=>[k,m[k]])); }
export function chatRoutes(pool) {
 const router = Router(); router.use(requireAuth);
 const wrap = fn => async (req,res,next) => { try { await fn(req,res); } catch(e) { if (e instanceof ChatError) res.status(e.status).json({error:e.message}); else next(e); } };
 router.get('/keys/me',wrap(async(req,res)=>res.json({userId:req.session.userId,key:await ownKey(pool,req.session.userId)})));
 router.post('/keys',wrap(async(req,res)=>res.status(201).json({key:await publishKey(pool,req.session.userId,req.body)})));
 router.get('/conversations/:id/keys',wrap(async(req,res)=>res.json({keys:await conversationKeys(pool,req.session.userId,req.params.id)})));
 router.get('/conversations', wrap(async(req,res) => res.json({conversations:(await pool.query(`SELECT c.id,c.kind,c.name, (SELECT string_agg(u.username, ', ' ORDER BY u.username) FROM conversation_members cm JOIN users u ON u.id=cm.user_id WHERE cm.conversation_id=c.id) AS members FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE cm.user_id=$1 ORDER BY c.id DESC`,[req.session.userId])).rows})));
 router.post('/conversations',wrap(async(req,res) => res.status(201).json(await createConversation(pool,req.session.userId,req.body))));
 router.get('/conversations/:id/messages',wrap(async(req,res) => res.json(await history(pool,req.session.userId,req.params.id,req.query.before))));
 return router;
}
