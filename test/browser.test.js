import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createPool } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { createChatServer } from '../server/realtime.js';

const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn) {const end=Date.now()+15000;while(Date.now()<end){const result=await fn();if(result)return result;await delay(50);}throw new Error('Tarayıcı koşulu zamanında sağlanmadı.');}
async function chromePath() {
  for(const path of [process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean))try{await access(path);return path;}catch{}
}
class CDP {
  constructor(ws){this.ws=ws;this.seq=0;this.pending=new Map();this.handlers=[];ws.addEventListener('message',e=>{
    const m=JSON.parse(e.data);if(m.id){const p=this.pending.get(m.id);this.pending.delete(m.id);if(p)m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}
    else this.handlers.forEach(fn=>fn(m));
  });}
  call(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++this.seq;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP zaman aşımı: ${method}`));},8000);this.pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
  async evaluate(sessionId,expression){const result=await this.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description ?? 'Tarayıcı JavaScript hatası');return result.result.value;}
}

test('Chrome: özel/grup sohbeti, yazar analizi, IndexedDB geçmişi ve anahtar kaybı', {timeout:90000},async t=>{
  const executable=await chromePath();if(!executable){t.skip('Chrome/Edge bulunamadı; CHROME_PATH ayarlayın.');return;}
  const pool=createPool({test:true}),users=[],conversations=[],frames=[],browserErrors=[];
  const {server,io}=createChatServer({pool,secret:randomBytes(48).toString('hex')});
  const profile=await mkdtemp(join(tmpdir(),'messaging-browser-'));
  let chrome,cdp;
  t.after(async()=>{
    if(cdp){try{await cdp.call('Browser.close');}catch{}cdp.ws.close();}
    if(chrome && chrome.exitCode===null){chrome.kill();await Promise.race([once(chrome,'exit'),delay(3000)]);}
    await new Promise(r=>io.close(r));
    for(const id of conversations){await pool.query('DELETE FROM writing_profiles WHERE conversation_id=$1',[id]);await pool.query('DELETE FROM messages WHERE conversation_id=$1',[id]);await pool.query('DELETE FROM conversation_members WHERE conversation_id=$1',[id]);await pool.query('DELETE FROM conversations WHERE id=$1',[id]);}
    for(const u of users){await pool.query('DELETE FROM user_public_keys WHERE user_id=$1',[u.id]);await pool.query("DELETE FROM sessions WHERE sess->>'userId'=$1",[u.id]);await pool.query('DELETE FROM users WHERE id=$1',[u.id]);}
    await pool.end();
    // Only remove the exact temporary profile created by this test.
    const within=relative(resolve(tmpdir()),resolve(profile));
    if(within && !within.startsWith('..') && !within.includes(':'))await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  });
  await migrate(pool);server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  chrome=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
  chrome.on('error',()=>{});
  const port=await until(async()=>{try{return (await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{return false;}});
  const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();const ws=new WebSocket(version.webSocketDebuggerUrl);await once(ws,'open');cdp=new CDP(ws);
  cdp.handlers.push(m=>{
    if(m.method==='Page.javascriptDialogOpening')void cdp.call('Page.handleJavaScriptDialog',{accept:true},m.sessionId);
    if(m.method==='Network.webSocketFrameSent' || m.method==='Network.webSocketFrameReceived')frames.push(m.params.response.payloadData);
    if(m.method==='Runtime.exceptionThrown')browserErrors.push(m.params.exceptionDetails.text);
  });
  const pages=[];
  for(let i=0;i<4;i++){
    const {browserContextId}=await cdp.call('Target.createBrowserContext');
    const {targetId}=await cdp.call('Target.createTarget',{url:'about:blank',browserContextId});
    const {sessionId}=await cdp.call('Target.attachToTarget',{targetId,flatten:true});pages.push(sessionId);
    await cdp.call('Page.enable',{},sessionId);await cdp.call('Runtime.enable',{},sessionId);await cdp.call('Network.enable',{},sessionId);
    await cdp.call('Page.navigate',{url:base},sessionId);
    await until(()=>cdp.evaluate(sessionId,`location.hash==='#login' && !document.querySelector('#auth-screen').hidden`));
    assert.equal(await cdp.evaluate(sessionId,`document.querySelector('#chat-screen').hidden`),true);
    await cdp.evaluate(sessionId,`document.querySelector('#auth-switch').click();true`);
    await until(()=>cdp.evaluate(sessionId,`location.hash==='#register' && document.querySelector('#account-title').textContent==='Kayıt ol'`));
    // Use the real registration form and its account-change/socket/key initialization flow.
    const username='browser_'+randomBytes(8).toString('hex'),password=randomBytes(24).toString('hex');
    if (i === 0) {
      await cdp.evaluate(sessionId,`history.back();true`);
      await until(()=>cdp.evaluate(sessionId,`document.querySelector('#account-title').textContent==='Giriş yap'`));
      await cdp.evaluate(sessionId,`history.forward();true`);
      await until(()=>cdp.evaluate(sessionId,`document.querySelector('#account-title').textContent==='Kayıt ol'`));
      await cdp.evaluate(sessionId,`document.querySelector('#account-form').requestSubmit();true`);
      assert.equal(await cdp.evaluate(sessionId,`document.querySelectorAll('[aria-invalid="true"]').length`),2);
    }
    const credentials = `document.querySelector('#account-form').elements.username.value=${JSON.stringify(username)};document.querySelector('#account-form').elements.password.value=${JSON.stringify(password)};document.querySelector('#account-form').requestSubmit();true`;
    await cdp.evaluate(sessionId,credentials);
    const user=await until(()=>cdp.evaluate(sessionId,`currentUser && ({id:currentUser.id,username:currentUser.username})`));users.push(user);
    await until(()=>cdp.evaluate(sessionId,`fetch('/api/keys/me').then(r=>r.json()).then(d=>!!d.key)`));
    await until(()=>cdp.evaluate(sessionId,`document.querySelector('#connection-status').textContent==='Anlık bağlantı açık.'`));
    if (i === 0) {
      assert.equal(await cdp.evaluate(sessionId,`location.hash`),'#chats');
      await cdp.evaluate(sessionId,`document.querySelector('#logout').click();true`);
      await until(()=>cdp.evaluate(sessionId,`location.hash==='#login' && document.querySelector('#chat-screen').hidden`));
      await cdp.evaluate(sessionId,credentials);
      await until(()=>cdp.evaluate(sessionId,`location.hash==='#chats' && document.querySelector('#connection-status').textContent==='Anlık bağlantı açık.'`));
    }
  }
  const [a,b,c,d]=pages;
  const ev=(page,expression)=>cdp.evaluate(page,expression);
  const create=async(body)=>{const r=await ev(a,`api('/conversations',${JSON.stringify(body)})`);conversations.push(r.id);return r.id;};
  const open=async(page,id)=>{
    await ev(page,`document.querySelector('#refresh-chats').click();true`);
    const selector=JSON.stringify(`#conversation-list button[data-chat-id="${id}"]`);
    await until(()=>ev(page,`!!document.querySelector(${selector})`));
    await ev(page,`document.querySelector(${selector}).click();true`);
    await until(()=>ev(page,`document.querySelector('#chat-state').textContent!=='Mesajlar yükleniyor…' && !document.querySelector('#message').disabled`));
  };
  const verify=async(page,id)=>{
    // Test simulates the external comparison against each member's locally generated public key.
    const directory=await ev(page,`api('/conversations/${id}/keys')`);
    for(const key of directory.keys){const index=users.findIndex(u=>u.id===key.user_id);assert.ok(index>=0);assert.deepEqual(await ev(pages[index],`import('/keyring.js').then(async({Keyring})=>(await new Keyring(currentUser.id,api).keys()).at(-1).publicKey)`),key.public_key);}
    await ev(page,`document.querySelector('#verify-keys').click();true`);
    await until(()=>ev(page,`document.querySelector('#chat-state').textContent==='Üye anahtarları bu tarayıcıda onaylandı.'`));
  };
  const send=async(page,text)=>{await ev(page,`document.querySelector('#message').value=${JSON.stringify(text)};document.querySelector('#message-form').requestSubmit();true`);};
  const contains=(page,text)=>until(()=>ev(page,`[...document.querySelectorAll('#messages p')].some(p=>p.textContent===${JSON.stringify(text)})`));
  const privateId=await create({kind:'private',userId:users[1].id});await open(a,privateId);await open(b,privateId);
  await send(a,'unverified');await until(()=>ev(a,`document.querySelector('#error-message').textContent.includes('doğrula')`));
  assert.equal((await pool.query('SELECT 1 FROM messages WHERE conversation_id=$1',[privateId])).rowCount,0);
  await verify(a,privateId);await verify(b,privateId);
  const privateText='<img src=x onerror=alert(1)> private-'+randomBytes(16).toString('hex');await send(a,privateText);await contains(b,privateText);await contains(a,privateText);
  const replyText='reply-'+randomBytes(16).toString('hex');
  await ev(b,`document.querySelector('#message').focus();true`);
  await cdp.call('Input.insertText',{text:replyText},b);
  const enter={key:'Enter',code:'Enter',windowsVirtualKeyCode:13};
  await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',modifiers:8,text:'\r',...enter},b);
  await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',modifiers:8,...enter},b);
  assert.equal(await ev(b,`document.querySelector('#message').value`),replyText+'\n');
  await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',text:'\r',...enter},b);
  await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',...enter},b);
  await contains(a,replyText+'\n');
  for (const [width, height] of [[1366, 768], [1920, 1080]]) {
    await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},a);
    assert.equal(await ev(a,`(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      return rect('.workspace').height === innerHeight &&
        rect('.sidebar').right === rect('.conversation').left &&
        rect('.incoming').left < rect('.outgoing').left &&
        rect('#message-form').bottom === innerHeight &&
        document.documentElement.scrollWidth === innerWidth;
    })()`),true);
  }
  await cdp.call('Page.reload',{},b);
  await until(()=>ev(b,`typeof currentUser!=='undefined' && !!currentUser && document.querySelector('#connection-status').textContent==='Anlık bağlantı açık.'`));await open(b,privateId);await contains(b,privateText);await contains(b,replyText+'\n');
  const denied=await ev(d,`fetch('/api/conversations/${privateId}/keys').then(r=>r.status)`);assert.equal(denied,403);
  assert.equal(await ev(d,`fetch('/api/conversations/${privateId}/messages').then(r=>r.status)`),403);
  assert.equal(await ev(b,"document.querySelector('#messages img') === null"),true);
  const examples=[
    'selam, bugün toplantı için hazırlık yapıyorum. dosyaları tek tek kontrol edip sana birazdan haber veririm. eksik kalan belgeleri de akşam tamamlarım.',
    'selam, yarınki toplantı için notlara bakıyorum. belgeleri sabah yanımda getiririm. erken gelirsen birlikte bir kahve içeriz, başka bir şey gerekirse yaz.',
  ];
  const candidates=[
    'selam, bugün belgeleri göndermeden önce son bir kontrol yaparım. toplantıda konuşacağımız konuları da listeye ekledim, akşam eve gidince sana haber veririm.',
    'yarın sabah erken gelirim, toplantıdan önce kahve alırım. kalan dosyaları yanımda getiriyorum. bir şey eksik olursa bana yaz, birlikte hallederiz.',
  ];
  const choose=(page, texts)=>ev(page, `for (const text of ${JSON.stringify(texts)}) {
    [...document.querySelectorAll('#messages article')].find(article=>article.querySelector('p').textContent===text)
      .querySelector('input').click();
  } true`);
  const writingStatus=(page,text)=>until(()=>ev(page,`document.querySelector('#writing-status').textContent.startsWith(${JSON.stringify(text)})`));
  const runWriting=page=>ev(page,"document.querySelector('#writing-action').click();true");
  await ev(a, "document.querySelector('#writing-panel').open=true;const mode=document.querySelector('#writing-mode');mode.value='profile';mode.dispatchEvent(new Event('change'));true");
  await runWriting(a);await writingStatus(a,'Örnek yok');
  for(const text of examples){await send(a,text);await contains(a,text);await contains(b,text);}
  await choose(a,examples);await runWriting(a);await writingStatus(a,'Yazım profili kaydedildi.');
  const profilePath='/conversations/'+privateId+'/writing-profiles/'+users[0].id;
  const savedProfile=await ev(b,'api('+JSON.stringify(profilePath)+')');
  for(const text of examples)assert.ok(!JSON.stringify(savedProfile).includes(text));
  await ev(b,"document.querySelector('#writing-panel').open=true;true");
  await until(()=>ev(b,"!!document.querySelector('#messages input')"));
  await choose(b,[privateText]);await runWriting(b);await writingStatus(b,'Yetersiz metin');
  await choose(b,[privateText]);
  await choose(b,examples);await runWriting(b);await writingStatus(b,'İşlem tamamlanamadı. Örneklerden sonra');
  await choose(b,examples);
  for(const text of candidates){await send(a,text);await contains(a,text);await contains(b,text);}
  await choose(b,candidates);await runWriting(b);await writingStatus(b,'Uyum');
  assert.deepEqual(await ev(b,'api('+JSON.stringify(profilePath)+')'),savedProfile);
  const groupId=await create({kind:'group',name:'Browser group',memberIds:[users[1].id,users[2].id]});
  for(const page of [a,b,c]){await open(page,groupId);await verify(page,groupId);}
  const groupTexts=[];
  for(const page of [a,b,c]){const text='group-'+randomBytes(16).toString('hex');groupTexts.push(text);await send(page,text);for(const reader of [a,b,c])await contains(reader,text);}
  await cdp.call('Page.reload',{},c);await until(()=>ev(c,`typeof currentUser!=='undefined' && !!currentUser && document.querySelector('#connection-status').textContent==='Anlık bağlantı açık.'`));await open(c,groupId);for(const text of groupTexts)await contains(c,text);
  const apiHistory=await ev(b,`api('/conversations/${groupId}/messages')`);
  const rows=(await pool.query('SELECT * FROM messages WHERE conversation_id=ANY($1::bigint[])',[conversations])).rows;
  for(const text of [privateText,replyText,...examples,...candidates,...groupTexts]){assert.ok(!JSON.stringify(rows).includes(text));assert.ok(!JSON.stringify(apiHistory).includes(text));assert.ok(!frames.some(frame=>frame.includes(text)));}
  assert.ok(rows.every(m=>m.content===null && m.encrypted_content));
  for(const serialized of [JSON.stringify(rows),JSON.stringify(apiHistory),...frames])assert.ok(!/"(?:privateKey|d|p|q|dp|dq|qi)"\s*:/.test(serialized));
  assert.equal(await ev(b,`import('/keyring.js').then(async({Keyring})=>{const k=(await new Keyring(currentUser.id,api).keys())[0].privateKey;try{await crypto.subtle.exportKey('jwk',k);return false;}catch{return !k.extractable;}})`),true);
  assert.equal(await ev(b,`import('/keyring.js').then(async({Keyring})=>(await new Keyring(${JSON.stringify(users[0].id)},api).keys()).length)`),0);
  assert.equal(await ev(b,`import('/keyring.js').then(async({Keyring})=>{try{await new Keyring(${JSON.stringify(users[0].id)},api).initialize();return false;}catch(e){return e.message.includes('Oturum hesabı değişti');}})`),true);
  // Delete only this test account's local record, simulating browser storage loss.
  await ev(c,`new Promise((resolve,reject)=>{const r=indexedDB.open('messaging-e2ee-v1',1);r.onsuccess=()=>{const tx=r.result.transaction('accounts','readwrite');tx.objectStore('accounts').delete(currentUser.id);tx.oncomplete=()=>{r.result.close();resolve(true);};tx.onerror=reject;};})`);
  await cdp.call('Page.reload',{},c);await until(()=>ev(c,`document.querySelector('#error-message').textContent.includes('yerel anahtarı bulunamadı')`));assert.equal(await ev(c,`document.querySelector('#send').disabled`),true);
  await ev(c,`document.querySelector('#reset-key').click();true`);
  await until(()=>ev(c,`fetch('/api/keys/me').then(r=>r.json()).then(d=>d.key?.key_version===2)`));await open(c,groupId);
  await until(()=>ev(c,`document.querySelector('#messages').textContent.includes('Mesaj açılamadı')`));
  await send(a,'after-key-change');await until(()=>ev(a,`document.querySelector('#error-message').textContent.includes('değişmiş')`));
  assert.equal((await pool.query('SELECT 1 FROM messages WHERE conversation_id=$1',[groupId])).rowCount,3);
  await verify(a,groupId);await verify(c,groupId);const fresh='fresh-'+randomBytes(12).toString('hex');await send(a,fresh);await contains(c,fresh);
  // Add legacy messages to the test conversation to exercise the history boundary.
  await pool.query(`INSERT INTO messages(conversation_id,sender_id,content)
    SELECT $1,$2,'Test geçmişi ' || n FROM generate_series(1,55) AS n`,[privateId,users[0].id]);
  await open(a,privateId);
  assert.equal(await ev(a,`document.querySelectorAll('#messages article').length`),50);
  const anchor=await ev(a,`(() => {
    const scroll = document.querySelector('#message-scroll');
    scroll.scrollTop = 0;
    const first = document.querySelector('#messages article');
    const anchor = { id: first.dataset.id, top: first.getBoundingClientRect().top };
    document.querySelector('#older').click();
    return anchor;
  })()`);
  await until(()=>ev(a,`document.querySelector('#older').hidden && document.querySelectorAll('#messages article').length>55`));
  assert.equal(await ev(a,`document.querySelector('[data-id="${anchor.id}"]').getBoundingClientRect().top`),anchor.top);
  assert.deepEqual(browserErrors,[]);
});
