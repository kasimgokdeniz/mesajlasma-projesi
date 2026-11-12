import { identity, fingerprint } from './crypto.js';
let dbPromise;
function database() {return dbPromise ??= new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(new Error('IndexedDB kullanılamıyor.'));return;}
  const req=indexedDB.open('messaging-e2ee-v1',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('accounts');
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error('Yerel anahtar deposu açılamadı.'));
});}
async function storage(userId, value) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('accounts',value===undefined?'readonly':'readwrite'), store=tx.objectStore('accounts');
    const request=value===undefined?store.get(userId):store.put(value,userId);
    tx.oncomplete=()=>resolve(request.result);tx.onerror=tx.onabort=()=>reject(new Error('Anahtarlar kaydedilemedi. Gönderim durduruldu.'));
  });
}
export class Keyring {
  constructor(userId, api, confirmKeys=message=>window.confirm(message)) {this.userId=userId;this.api=api;this.confirm=confirmKeys;}
  async locked(fn) {
    if(!globalThis.isSecureContext || !crypto.subtle || !navigator.locks) throw new Error('Şifreleme için HTTPS (veya localhost), Web Crypto ve tarayıcı kilit desteği gerekli.');
    return navigator.locks.request(`messaging-key-${this.userId}`,fn);
  }
  async initialize(reset=false) {return this.locked(async()=>{
    const saved=await storage(this.userId) ?? {keys:[],pins:{}};
    const directory=await this.api('/keys/me');
    if(directory.userId!==this.userId)throw new Error('Oturum hesabı değişti. Sayfayı yenileyin.');
    const remote=directory.key;
    const matching=remote && await Promise.all(saved.keys.map(async k=>({k,match:await fingerprint(k.publicKey)===await fingerprint(remote.public_key)})));
    const found=matching?.find(x=>x.match)?.k;
    if(found && !reset){if(found.version && found.version!==remote.key_version)saved.keys.push({...found,version:remote.key_version});else found.version=remote.key_version;await storage(this.userId,saved);return;}
    if(remote && !reset) throw new Error('Bu hesabın yerel anahtarı bulunamadı. Eski tarayıcı profilini kullanın veya “Anahtarı yenile” ile yalnızca gelecek mesajlar için yeni anahtar oluşturun.');
    if(reset && !this.confirm('Anahtar yenilensin mi? Diğer üyeler yeni parmak izini tekrar doğrulamalı. Kaybolan anahtarla şifrelenmiş geçmiş kurtarılamaz.')) return;
    const local=await identity();
    // Persist before publishing: a lost response can be recovered by matching the public key.
    saved.keys.push(local);await storage(this.userId,saved);
    const result=await this.api('/keys',{userId:this.userId,publicKey:local.publicKey,expectedVersion:remote?.key_version ?? 0});
    local.version=result.key.key_version;await storage(this.userId,saved);
  });}
  async keys() {return (await storage(this.userId))?.keys ?? [];}
  async ownFingerprint() {
    const directory=await this.api('/keys/me');
    if(directory.userId!==this.userId || !directory.key)throw new Error('Oturum hesabı değişti veya yayımlanmış anahtar yok.');
    const expected=await fingerprint(directory.key.public_key);
    if(!(await Promise.all((await this.keys()).map(k=>fingerprint(k.publicKey)))).includes(expected))throw new Error('Güncel anahtar bu tarayıcıda yok.');
    return expected;
  }
  async recipients(conversationId, verify=false) {
    const {keys}=await this.api(`/conversations/${conversationId}/keys`);
    if(keys.some(k=>!k.public_key)) throw new Error('Bir üyenin anahtarı eksik. Her üye önce kendi tarayıcısında giriş yapmalı.');
    return this.locked(async()=>{
      const saved=await storage(this.userId) ?? {keys:[],pins:{}};
      const prints=await Promise.all(keys.map(async k=>({...k,print:await fingerprint(k.public_key)})));
      const own=prints.find(k=>k.user_id===this.userId);
      if(!own || !await Promise.all(saved.keys.map(k=>fingerprint(k.publicKey))).then(values=>values.includes(own.print))) throw new Error('Kendi açık anahtarınız yerel anahtarla eşleşmiyor. Gönderim durduruldu; sayfayı yenileyin.');
      const changed=prints.filter(k=>saved.pins[k.user_id]!==k.print);
      if(changed.length && !verify) throw new Error('İlk veya değişmiş üye anahtarı var. “Üye anahtarlarını doğrula” düğmesiyle parmak izlerini karşılaştırın.');
      if(verify){
        const text=prints.map(k=>`${k.username} (v${k.key_version})${saved.pins[k.user_id] && saved.pins[k.user_id]!==k.print?' — DEĞİŞTİ':''}\n${k.print}`).join('\n\n');
        if(!this.confirm(`Parmak izlerini her üyenin kendi ekranındaki değerle, yüz yüze veya başka güvenilir kanaldan karşılaştırın. İlk anahtar sunucudan gelir; karşılaştırma yapılmadan kimlik doğrulanmış sayılmaz.\n\n${text}\n\nKarşılaştırdınız ve tümünü onaylıyor musunuz?`)) throw new Error('Anahtar doğrulaması tamamlanmadı.');
        prints.forEach(k=>saved.pins[k.user_id]=k.print);await storage(this.userId,saved);
      }
      return keys;
    });
  }
}
