import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { io as client } from 'socket.io-client';
import { createPool } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { createChatServer } from '../server/realtime.js';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('Gerçek PostgreSQL ve Socket.IO sohbet kabul kontrolleri', {timeout:40000}, async t=>{
 const pool=createPool({test:true});const users=[],sockets=[],conversations=[];
 const {server,io}=createChatServer({pool,secret:randomBytes(48).toString('hex')});
 t.after(async()=>{sockets.forEach(s=>s.disconnect());await new Promise(resolve=>io.close(resolve));
  for(const id of conversations){await pool.query('DELETE FROM messages WHERE conversation_id=$1',[id]);await pool.query('DELETE FROM conversation_members WHERE conversation_id=$1',[id]);await pool.query('DELETE FROM conversations WHERE id=$1',[id]);}
  for(const u of users){await pool.query("DELETE FROM sessions WHERE sess->>'userId'=$1",[u.id]);await pool.query('DELETE FROM users WHERE id=$1',[u.id]);}await pool.end();
 });
 await migrate(pool);server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const request=(path,body,cookie)=>fetch(base+'/api'+path,{headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
 for(let i=0;i<4;i++){const r=await request('/auth/register',{username:'chat_'+randomBytes(8).toString('hex'),password:randomBytes(24).toString('hex')});assert.equal(r.status,201);users.push({...((await r.json()).user),cookie:r.headers.get('set-cookie').split(';')[0]});}
 const connect=async(cookie,extra={})=>{const s=client(base,{autoConnect:false,reconnection:false,extraHeaders:cookie?{cookie}: {},...extra});sockets.push(s);const p=new Promise((resolve,reject)=>{s.once('connect',()=>resolve(s));s.once('connect_error',reject);});s.connect();return p;};
 const emit=(s,event,body)=>new Promise((resolve,reject)=>s.timeout(5000).emit(event,body,(e,r)=>e?reject(e):resolve(r)));
 const [a,b,c,d]=await Promise.all(users.map((u,i)=>connect(u.cookie,i===2?{transports:['websocket']}:{})));
 assert.equal(c.io.engine.transport.name,'websocket');
 let privateId,groupId;
 await t.test('Özel sohbet eşzamanlı/ters yönde benzersiz, grup kurucusu ve üyeleri doğru',async()=>{
  const replies=await Promise.all(Array.from({length:6},(_,i)=>request('/conversations',{kind:'private',userId:users[i%2?0:1].id},users[i%2?1:0].cookie)));
  const ids=await Promise.all(replies.map(async r=>{assert.equal(r.status,201);return(await r.json()).id;}));assert.equal(new Set(ids).size,1);privateId=ids[0];conversations.push(privateId);
  for(const body of [{kind:'group',name:'',memberIds:users.slice(1,3).map(u=>u.id)},{kind:'group',name:'test',memberIds:[users[1].id]},{kind:'group',name:'test',memberIds:[users[1].id,'999999999999']},{kind:'private',userId:users[0].id}])assert.equal((await request('/conversations',body,users[0].cookie)).status,400);
  const r=await request('/conversations',{kind:'group',name:'Yerel test',memberIds:[users[1].id,users[2].id]},users[0].cookie);assert.equal(r.status,201);groupId=(await r.json()).id;conversations.push(groupId);
  const members=await pool.query('SELECT user_id FROM conversation_members WHERE conversation_id=$1',[groupId]);assert.deepEqual(members.rows.map(x=>x.user_id).sort(),users.slice(0,3).map(u=>u.id).sort());
  assert.equal((await(await request('/conversations',undefined,users[2].cookie)).json()).conversations.some(x=>x.id===groupId),true);
 });
 await t.test('Oturumsuz, sahte ve çapraz kaynak socket; yetkisiz geçmiş/join/send/typing reddi',async()=>{
  await assert.rejects(connect());await assert.rejects(connect('messaging.sid=forged'));await assert.rejects(connect(users[0].cookie,{extraHeaders:{cookie:users[0].cookie,origin:'http://evil.example'}}));
  assert.equal((await request(`/conversations/${privateId}/messages`)).status,401);
  assert.equal((await request(`/conversations/${privateId}/messages`,undefined,users[2].cookie)).status,403);
  for(const [event,body]of [['join',{conversationId:privateId}],['message',{conversationId:privateId,content:'no',clientId:randomUUID()}],['typing',{conversationId:privateId,active:true}]])assert.equal((await emit(c,event,body)).ok,false);
  assert.equal((await emit(a,'join',null)).ok,false);assert.equal((await emit(a,'join',{conversationId:'9223372036854775808'})).ok,false);
  assert.equal((await request(`/conversations/${groupId}/messages`,undefined,users[3].cookie)).status,403);
  for (const event of ['join','message','typing']) {
   assert.equal((await emit(d,event,{conversationId:groupId,content:'denied',clientId:randomUUID(),active:true})).ok,false);
  }
  assert.equal((await emit(a,'typing',{conversationId:privateId,active:'yes'})).ok,false);
  assert.equal((await request(`/conversations/${privateId}/messages?before=invalid`,undefined,users[0].cookie)).status,400);
 });
 await t.test('Özel mesaj yayınlanır, gönderen sunucudan; tekrar kayıt ve boş/uzun mesaj engeli',async()=>{
  await emit(a,'join',{conversationId:privateId});await emit(b,'join',{conversationId:privateId});
  const received=once(b,'message');const payload={conversationId:privateId,content:'<img src=x onerror=alert(1)>',clientId:randomUUID(),senderId:users[2].id};
  const first=await emit(a,'message',payload);assert.equal(first.ok,true);assert.equal((await received)[0].sender_id,users[0].id);assert.equal(first.message.content,payload.content);assert.ok(first.message.created_at);
  const retry=await emit(a,'message',payload);assert.equal(first.message.id,retry.message.id);
  assert.equal((await pool.query('SELECT 1 FROM messages WHERE conversation_id=$1',[privateId])).rowCount,1);
  for(const content of ['', '   ', 'x'.repeat(1001), null, {}])assert.equal((await emit(a,'message',{...payload,clientId:randomUUID(),content})).ok,false);
  assert.equal((await emit(a,'message',{...payload,clientId:'bad'})).ok,false);
 });
 await t.test('Sayfalama, yenileme ve yeniden bağlantıda kalıcı geçmiş',async()=>{
  for(let i=0;i<54;i++)assert.equal((await emit(a,'message',{conversationId:privateId,content:'history '+i,clientId:randomUUID()})).ok,true);
  const page=await(await request(`/conversations/${privateId}/messages`,undefined,users[1].cookie)).json();assert.equal(page.messages.length,50);assert.ok(page.nextBefore);
  const previous=await(await request(`/conversations/${privateId}/messages?before=${page.nextBefore}`,undefined,users[1].cookie)).json();assert.equal(previous.messages.length,5);assert.equal(previous.nextBefore,null);assert.equal(new Set([...page.messages,...previous.messages].map(m=>m.id)).size,55);
  b.disconnect();const reconnected=await connect(users[1].cookie);await emit(reconnected,'join',{conversationId:privateId});
  assert.deepEqual((await(await request(`/conversations/${privateId}/messages`,undefined,users[1].cookie)).json()).messages.map(m=>m.id),page.messages.map(m=>m.id));
 });
 await t.test('Grup iletimi ve yazıyor yalnızca ilgili üyelerde, üç saniye/gönderim/kopmada temizlenir',async()=>{
  const bb=await connect(users[1].cookie);for(const s of [a,bb,c])await emit(s,'join',{conversationId:groupId});
  let leaked=0;d.on('typing',()=>leaked++);d.on('message',()=>leaked++);
  let incoming=once(c,'message');assert.equal((await emit(a,'message',{conversationId:groupId,content:'group',clientId:randomUUID()})).ok,true);assert.equal((await incoming)[0].conversation_id,groupId);
  const waitTyping=active=>new Promise(resolve=>{const handler=data=>{if(data.active===active){c.off('typing',handler);resolve(data);}};c.on('typing',handler);});
  const started=Date.now();
  let on=waitTyping(true),off=waitTyping(false);await emit(a,'typing',{conversationId:groupId,active:true});assert.equal((await on).userId,users[0].id);await off;assert.ok(Date.now()-started>=2900);
  on=waitTyping(true);await emit(a,'typing',{conversationId:groupId,active:true});await on;off=waitTyping(false);await emit(a,'message',{conversationId:groupId,content:'clears',clientId:randomUUID()});await off;
  on=waitTyping(true);await emit(a,'typing',{conversationId:groupId,active:true});await on;off=waitTyping(false);a.disconnect();await off;assert.equal(leaked,0);
 });
 await t.test('Çıkış, iptal ve süresi dolmuş oturum açık bağlantıda işlemi durdurur',async()=>{
  const aa=await connect(users[0].cookie);assert.equal((await request('/auth/logout',{},users[0].cookie)).status,200);
  assert.equal((await emit(aa,'message',{conversationId:groupId,content:'after logout',clientId:randomUUID()})).ok,false);
  assert.equal((await request(`/conversations/${groupId}/messages`,undefined,users[0].cookie)).status,401);await assert.rejects(connect(users[0].cookie));
  await pool.query("UPDATE sessions SET expire=now()-interval '1 minute' WHERE sess->>'userId'=$1",[users[3].id]);
  assert.equal((await emit(d,'join',{conversationId:groupId})).ok,false);
  await sleep(30);
 });
});
