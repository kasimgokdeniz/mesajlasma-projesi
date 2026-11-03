import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { member, saveMessage, ChatError } from './chat.js';
export function createChatServer(options) {
 const app = createApp(options), server = createServer(app);
 const io = new Server(server, { maxHttpBufferSize: 8192, allowRequest: (req,done) => { const origin=req.headers.origin; done(null,!origin || origin === `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`); } });
 io.engine.use(app.locals.sessionMiddleware);
 const authenticate = async socket => {
  await new Promise((resolve,reject) => socket.request.session.reload(e => e ? reject(new ChatError('Oturum geçersiz.',401)) : resolve()));
  const userId=socket.request.session.userId;
  if (!userId || !(await options.pool.query('SELECT 1 FROM users WHERE id=$1',[userId])).rowCount) throw new ChatError('Oturum geçersiz.',401);
  return userId;
 };
 const broadcast = async (room,event,data,except) => {
  const recipients = await io.in(room).fetchSockets();
  await Promise.all(recipients.filter(s=>s.id!==except).map(async recipient=>{
   try {
    const userId = await authenticate(recipient);
    await member(options.pool, room.slice(5), userId);
    recipient.emit(event,data);
   } catch { recipient.disconnect(true); }
  }));
 };
 io.use(async(socket,next) => { try { await authenticate(socket); next(); } catch { next(new Error('Önce giriş yapın.')); } });
 io.on('connection',socket => {
  const typing=new Map();
  const clear = conversationId => { const entry=typing.get(conversationId); if (!entry) return; clearTimeout(entry.timer); typing.delete(conversationId); void broadcast(`chat:${conversationId}`,'typing',{conversationId,userId:entry.userId,username:entry.username,active:false},socket.id); };
  // Preserve packet order while asynchronous session and membership queries run.
  let operations = Promise.resolve();
  const run = (event, fn) => socket.on(event, (body, ack) => {
    if (typeof ack !== 'function') return;
    operations = operations.then(async () => {
      if (!socket.connected) return;
      try {
        const userId = await authenticate(socket);
        ack({ ok: true, ...await fn(body, userId) });
      } catch (e) {
        ack({ ok: false, error: e instanceof ChatError ? e.message : 'İşlem tamamlanamadı.' });
        if (e.status === 401) socket.disconnect(true);
      }
    });
  });
  run('join',async(body,userId) => { await member(options.pool,body?.conversationId,userId); for(const room of socket.rooms) if(room.startsWith('chat:')) { clear(room.slice(5)); socket.leave(room); } await socket.join(`chat:${body.conversationId}`); return {}; });
  run('message',async(body,userId) => { const message=await saveMessage(options.pool,userId,body); clear(body.conversationId); await broadcast(`chat:${message.conversation_id}`,'message',message); return {message}; });
  run('typing',async(body,userId) => {
   await member(options.pool,body?.conversationId,userId); if(typeof body.active!=='boolean') throw new ChatError('Geçersiz yazıyor paketi.');
   if (!body.active) clear(body.conversationId);
   else if (typing.has(body.conversationId)) clearTimeout(typing.get(body.conversationId).timer);
   if(body.active) { const username=(await options.pool.query('SELECT username FROM users WHERE id=$1',[userId])).rows[0].username; typing.set(body.conversationId,{userId,username,timer:setTimeout(()=>clear(body.conversationId),3000)}); await broadcast(`chat:${body.conversationId}`,'typing',{conversationId:body.conversationId,userId,username,active:true},socket.id); } return {};
  });
  const expiry=setInterval(()=>authenticate(socket).catch(()=>socket.disconnect(true)),1000); expiry.unref();
  socket.on('disconnect',()=>{ clearInterval(expiry); for(const key of typing.keys()) clear(key); });
 });
 return {app,server,io};
}
