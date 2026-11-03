/* Plaintext local-development chat. All user text is rendered using textContent. */
const chatState = document.querySelector('#chat-state');
const messageBox = document.querySelector('#message');
const sendButton = document.querySelector('#send');
const messagesNode = document.querySelector('#messages');
const older = document.querySelector('#older');
const groupForm = document.querySelector('#group-form');
const chatList = document.querySelector('#conversation-list');
const chatRefresh = document.querySelector('#refresh-chats');
const typingNode = document.querySelector('#typing');
let socket, selected = null, nextBefore = null, generation = 0, loading = false, pending = null;
const rendered = new Map(), writers = new Map();
function updateComposer() { messageBox.disabled = sendButton.disabled = !selected || !socket?.connected || loading; }
function showWriters() { typingNode.textContent = [...writers.values()].join(', ') + (writers.size ? ' yazıyor…' : ''); }
function emit(event,body) { return new Promise((resolve,reject) => {
 if (!socket?.connected) return reject(new Error('Bağlantı yok. Yeniden bağlanmayı bekleyin.'));
 socket.timeout(6000).emit(event,body,(err,result) => err ? reject(new Error('Yanıt alınamadı. Aynı mesajı yeniden deneyebilirsiniz.')) : result.ok ? resolve(result) : reject(new Error(result.error)));
}); }
function render(message) {
 if(message.conversation_id !== selected) return;
 rendered.set(message.id,message);
 messagesNode.replaceChildren(...[...rendered.values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1).map(m=>{
  const article=document.createElement('article'), meta=document.createElement('small'), text=document.createElement('p');
  meta.textContent=`${m.username} · ${new Date(m.created_at).toLocaleString('tr-TR')}`; text.textContent=m.content; article.append(meta,text); return article;
 }));
 if(!loading) chatState.textContent=rendered.size ? '' : 'Henüz mesaj yok. İlk mesajı yazın.';
}
async function loadChats() {
 const data=await api('/conversations');
 chatList.replaceChildren(...data.conversations.map(c=>{const li=document.createElement('li'),b=document.createElement('button'); b.textContent=c.name || c.members; b.onclick=()=>selectChat(c.id,b.textContent).catch(e=>showError(e.message)); li.append(b);return li;}));
}
async function loadHistory(before, token=generation) {
 const conversationId=selected; loading=true;updateComposer();older.disabled=true;chatState.textContent='Mesajlar yükleniyor…';
 try { const data=await api(`/conversations/${conversationId}/messages${before ? `?before=${before}` : ''}`); if(token!==generation)return;
  data.messages.forEach(render);nextBefore=data.nextBefore;older.hidden=!nextBefore;chatState.textContent=rendered.size ? '' : 'Henüz mesaj yok. İlk mesajı yazın.';
 } finally {if(token===generation){loading=false;older.disabled=false;updateComposer();}}
}
async function selectChat(conversationId,title) {
 if(selected && socket?.connected) emit('typing',{conversationId:selected,active:false}).catch(()=>{});
 selected=conversationId;pending=null;messageBox.value='';generation++;rendered.clear();writers.clear();showWriters();messagesNode.replaceChildren();older.hidden=true;
 document.querySelector('#chat-title').textContent=title; loading=true;updateComposer();
 const token = generation;
 try {await emit('join',{conversationId});if(token!==generation)return;await loadHistory(null,token);} catch(e){if(token!==generation)return;loading=false;updateComposer();chatState.textContent='Sohbet yüklenemedi. Sohbeti yeniden seçin.';throw e;}
}
window.addEventListener('account-change',event=>{
 socket?.disconnect();socket=null;selected=null;generation++;loading=false;rendered.clear();messagesNode.replaceChildren();writers.clear();showWriters();chatList.replaceChildren();older.hidden=true;
 groupForm.hidden=chatRefresh.hidden=!event.detail;updateComposer();if(!event.detail)return;
 socket=io();
 socket.on('connect',async()=>{status.textContent='Anlık bağlantı açık.';writers.clear();showWriters();try{await loadChats();if(selected){rendered.clear();messagesNode.replaceChildren();await emit('join',{conversationId:selected});await loadHistory(null);}}catch(e){showError(e.message);}updateComposer();});
 socket.on('disconnect',()=>{status.textContent='Bağlantı kesildi. Yeniden bağlanılıyor…';writers.clear();showWriters();updateComposer();});
 socket.on('connect_error',()=>{status.textContent='Sohbet bağlantısı kurulamadı. Oturumunuzu ve sunucuyu kontrol edin.';updateComposer();});
 socket.on('message',render);
 socket.on('typing',data=>{if(data.conversationId!==selected)return;if(data.active)writers.set(data.userId,data.username);else writers.delete(data.userId);showWriters();});
});
window.addEventListener('users-loaded',event=>{
 document.querySelector('#group-members').replaceChildren(...event.detail.map(user=>{const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=user.id;label.append(box,document.createTextNode(user.username));return label;}));
});
window.addEventListener('open-private',async event=>{try{const c=await api('/conversations',{kind:'private',userId:event.detail.id});await loadChats();await selectChat(c.id,event.detail.username);}catch(e){showError(e.message);}});
groupForm.onsubmit=async event=>{event.preventDefault();const button=groupForm.querySelector('button');button.disabled=true;try{const c=await api('/conversations',{kind:'group',name:document.querySelector('#group-name').value,memberIds:[...groupForm.querySelectorAll('input:checked')].map(i=>i.value)});await loadChats();await selectChat(c.id,document.querySelector('#group-name').value);groupForm.reset();}catch(e){showError(e.message);}finally{button.disabled=false;}};
chatRefresh.onclick=()=>loadChats().catch(e=>showError(e.message));
older.onclick=()=>loadHistory(nextBefore).catch(e=>{chatState.textContent='Geçmiş yüklenemedi. Yeniden deneyin.';showError(e.message);});
messageBox.oninput=()=>{pending=null;if(selected)emit('typing',{conversationId:selected,active:!!messageBox.value.trim()}).catch(()=>{});};
document.querySelector('#message-form').onsubmit=async event=>{
 event.preventDefault();const content=messageBox.value;if(!content.trim() || content.length>1000){showError('Mesaj 1–1000 karakter olmalı.');return;}
 if(!pending)pending={conversationId:selected,content,clientId:crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(Number(c)^crypto.getRandomValues(new Uint8Array(1))[0]&15>>Number(c)/4).toString(16))};
 const outgoing=pending;sendButton.disabled=true;
 try{const result=await emit('message',outgoing);render(result.message);if(pending===outgoing){messageBox.value='';pending=null;}}catch(e){showError(e.message);}finally{updateComposer();}
};
