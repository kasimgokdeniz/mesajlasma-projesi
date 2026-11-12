// This module is also exercised with Node's implementation of Web Crypto.
const encoder = new TextEncoder();
export const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const unb64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export async function fingerprint(publicKey) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify({ e: publicKey.e, kty: 'RSA', n: publicKey.n })));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
}
export async function identity() {
  const pair = await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']);
  const {kty,n,e} = await crypto.subtle.exportKey('jwk',pair.publicKey);
  return {privateKey:pair.privateKey,publicKey:{kty,n,e}};
}
const aad = (conversationId,senderId,clientId) => encoder.encode(JSON.stringify([1,conversationId,senderId,clientId]));
export async function encryptMessage(content, conversationId, senderId, clientId, recipients) {
  if(typeof content!=='string' || !content.trim() || content.length>1000) throw new Error('Mesaj 1–1000 karakter olmalı.');
  if(recipients.some(r=>!r.public_key || !r.key_version)) throw new Error('Bir üyenin anahtarı eksik. Önce kendi tarayıcısında giriş yapmalı.');
  // Each AES key is used for exactly one encryption. Retries reuse the whole packet.
  const raw=crypto.getRandomValues(new Uint8Array(32));
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12)), additionalData=aad(conversationId,senderId,clientId);
  try {
    const ciphertext=b64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData,tagLength:128},key,encoder.encode(content)));
    const envelopes=await Promise.all(recipients.map(async r=>{
      const publicKey=await crypto.subtle.importKey('jwk',r.public_key,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
      return {userId:r.user_id,keyVersion:r.key_version,wrapped:b64(await crypto.subtle.encrypt({name:'RSA-OAEP',label:additionalData},publicKey,raw))};
    }));
    return {v:1,iv:b64(iv),ciphertext,envelopes};
  } finally {raw.fill(0);}
}
export async function decryptMessage(message, userId, identities) {
  if(!message.encrypted_content) return `Eski açık metin kaydı (E2EE değil): ${message.content ?? '[boş]'}`;
  try {
    const p=message.encrypted_content, envelope=p.envelopes.find(e=>e.userId===userId);
    if(p.v!==1 || !envelope) throw new Error();
    const local=identities.find(k=>k.version===envelope.keyVersion);
    if(!local) throw new Error();
    const additionalData=aad(message.conversation_id,message.sender_id,message.client_id);
    const raw=await crypto.subtle.decrypt({name:'RSA-OAEP',label:additionalData},local.privateKey,unb64(envelope.wrapped));
    const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
    new Uint8Array(raw).fill(0);
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(p.iv),additionalData,tagLength:128},key,unb64(p.ciphertext));
    const content=new TextDecoder('utf-8',{fatal:true}).decode(plaintext);
    if(!content.trim() || content.length>1000) throw new Error();
    return content;
  } catch {throw new Error('Mesaj açılamadı: bu tarayıcıda gerekli anahtar yok veya paket doğrulanamadı. Eski tarayıcı profilinizi kullanın.');}
}
