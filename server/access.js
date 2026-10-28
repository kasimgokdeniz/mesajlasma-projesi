export function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Önce giriş yapın.' });
  next();
}

// Gelecek aşamalardaki her sohbet/mesaj işlemi bu denetimi kullanmalı.
export async function isConversationMember(pool, conversationId, userId) {
  if (!/^\d+$/.test(String(conversationId))) return false;
  const result = await pool.query('SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [conversationId, userId]);
  return result.rowCount > 0;
}
