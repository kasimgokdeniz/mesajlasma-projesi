import { encryptMessage, decryptMessage } from './crypto.js';
import { setWritingContext, renderWritingMessages } from './writing-panel.js';
import { Keyring } from './keyring.js';

const chatState = document.querySelector('#chat-state');
const messageBox = document.querySelector('#message');
const messageForm = document.querySelector('#message-form');
const sendButton = document.querySelector('#send');
const messagesNode = document.querySelector('#messages');
const scroller = document.querySelector('#message-scroll');
const older = document.querySelector('#older');
const writingOlder = document.querySelector('#writing-older');
const writingHistory = document.querySelector('#writing-history-state');
const securityStatus = document.querySelector('#security-status');
const securitySelect = document.querySelector('#security-chat');
const verifyKeys = document.querySelector('#verify-keys');
const ownKey = document.querySelector('#own-key');
const resetKey = document.querySelector('#reset-key');
const fingerprintOutput = document.querySelector('#fingerprint');
let writingRoute, securityRoute, securityOperation, securityChat, requestedRoute;
const chatList = document.querySelector('#conversation-list');
const chatRefresh = document.querySelector('#refresh-chats');
const search = document.querySelector('#chat-search');
const listState = document.querySelector('#list-state');
const typingNode = document.querySelector('#typing');
const timeFormat = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long' });
const searchKey = text => text.toLocaleLowerCase('tr-TR').replaceAll('ı', 'i');

let socket, keyring, keyReady, ready = false;
let selected = null, nextBefore = null, generation = 0, pending = null, sending = false;
let joined = false, loading = false, historyLoaded = false, listRequest = 0, listMessage = '';
let chats = [];
const rendered = new Map(), writers = new Map();

function updateComposer() {
  messageBox.disabled = !ready || !joined || !socket?.connected;
  sendButton.disabled = messageBox.disabled || sending;
}

function setChatState(message = '') {
  chatState.textContent = message;
  chatState.hidden = !message;
  writingHistory.textContent = message;
}

function showWriters() {
  typingNode.hidden = !writers.size;
  typingNode.textContent = writers.size ? `${[...writers.values()].join(', ')} yazıyor…` : '';
}

function emit(event, body) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) return reject(new Error('Bağlantı yok. Yeniden bağlanmayı bekleyin.'));
    socket.timeout(6000).emit(event, body, (err, result) => {
      if (err) reject(new Error('Yanıt alınamadı. İşlemi yeniden deneyebilirsiniz.'));
      else if (!result?.ok) reject(new Error(result?.error || 'İşlem tamamlanamadı.'));
      else resolve(result);
    });
  });
}

async function decode(message, ring, readiness) {
  try {
    await readiness;
    return { ...message, content: await decryptMessage(message, ring.userId, await ring.keys()), decrypted: true };
  } catch (err) {
    return { ...message, content: err.message, decrypted: false };
  }
}

async function receive(message) {
  if (message.conversation_id !== selected?.id || rendered.has(message.id)) return;
  const token = generation;
  const decoded = await decode(message, keyring, keyReady);
  if (token !== generation || rendered.has(message.id)) return;
  rendered.set(message.id, decoded);
  renderMessages('follow');
  if (joined && !loading && chatState.textContent === 'Henüz mesaj yok. İlk mesajı yazın.') setChatState();
}

function renderMessages(scrollMode) {
  const follow = scrollMode === 'bottom' || (scrollMode === 'follow' &&
    scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 48);
  const top = scroller.getBoundingClientRect().top;
  const anchor = follow ? null : [...messagesNode.querySelectorAll('article')].find(node => node.getBoundingClientRect().bottom > top);
  const offset = anchor?.getBoundingClientRect().top;
  older.hidden = writingOlder.hidden = !nextBefore;
  const nodes = new Map();
  const fragment = document.createDocumentFragment();
  let previousDay;

  const ordered = [...rendered.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
  for (const message of ordered) {
    const date = new Date(message.created_at);
    const day = dateFormat.format(date);
    if (day !== previousDay) {
      const divider = document.createElement('div');
      divider.className = 'day-divider';
      divider.textContent = day;
      fragment.append(divider);
      previousDay = day;
    }
    const article = document.createElement('article');
    const own = message.sender_id === keyring?.userId;
    article.className = own ? 'bubble outgoing' : 'bubble incoming';
    article.dataset.id = message.id;
    if (selected?.kind === 'group') {
      const author = document.createElement('strong');
      author.textContent = message.username;
      article.append(author);
    }
    const text = document.createElement('p');
    text.textContent = message.content;
    const time = document.createElement('time');
    time.dateTime = message.created_at;
    time.textContent = timeFormat.format(date);
    article.append(text, time);
    nodes.set(message.id, article);
    fragment.append(article);
  }
  messagesNode.replaceChildren(fragment);
  if (follow) scroller.scrollTop = scroller.scrollHeight;
  else if (anchor && nodes.has(anchor.dataset.id)) scroller.scrollTop += nodes.get(anchor.dataset.id).getBoundingClientRect().top - offset;
  renderWritingMessages();
}

function chatName(chat) {
  return chat.name || chat.members.split(', ').find(name => name !== currentUser?.username) || chat.members;
}

function renderChats() {
  const query = searchKey(search.value.trim());
  const matches = chats.filter(chat => searchKey(chatName(chat)).includes(query));
  chatList.replaceChildren(...matches.map(chat => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    const avatar = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'chat-name';
    name.textContent = chatName(chat);
    avatar.className = 'avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = initials(name.textContent);
    button.type = 'button';
    button.dataset.chatId = chat.id;
    if (chat.id === selected?.id) button.setAttribute('aria-current', 'true');
    button.append(avatar, name);
    if (chat.last_message_at) {
      const time = document.createElement('time');
      const date = new Date(chat.last_message_at);
      time.dateTime = chat.last_message_at;
      time.title = date.toLocaleString('tr-TR');
      time.textContent = date.toDateString() === new Date().toDateString() ? timeFormat.format(date) : date.toLocaleDateString('tr-TR');
      button.append(time);
    }
    button.onclick = () => {
      const hash = `#chats/${chat.id}`;
      if (location.hash !== hash) location.hash = hash;
      else if (!joined && !loading && socket?.connected) void joinSelected();
    };
    li.append(button);
    return li;
  }));
  listState.textContent = listMessage || (matches.length ? '' : query ? 'Aramanızla eşleşen sohbet yok.' : 'Henüz sohbet yok. Kişilerden bir sohbet başlatın.');
  listState.hidden = !listState.textContent;
}

async function loadChats() {
  const request = ++listRequest;
  listMessage = chats.length ? '' : 'Sohbetler yükleniyor…';
  listState.textContent = listMessage;
  listState.hidden = !listMessage;
  try {
    const data = await api('/conversations');
    if (request !== listRequest) return;
    chats = data.conversations;
    listMessage = '';
  } catch (err) {
    if (request === listRequest) listMessage = 'Sohbetler alınamadı. Listeyi yeniden yükleyin.';
    throw err;
  } finally {
    if (request === listRequest) {
      renderChats();
      syncRoute();
    }
  }
}

async function loadHistory({ before = null, reconnect = false } = {}) {
  const token = generation;
  const conversationId = selected.id;
  const ring = keyring, readiness = keyReady;
  loading = true;
  older.disabled = writingOlder.disabled = true;
  setChatState('Mesajlar yükleniyor…');
  try {
    let cursor = before;
    let page;
    const batch = [];
    do {
      page = await api(`/conversations/${conversationId}/messages${cursor ? `?before=${cursor}` : ''}`);
      if (token !== generation) return;
      batch.push(...page.messages.filter(message => !rendered.has(message.id)));
      cursor = page.nextBefore;
    } while (reconnect && cursor && !page.messages.some(message => rendered.has(message.id)));

    const decoded = await Promise.all(batch.map(message => decode(message, ring, readiness)));
    if (token !== generation) return;
    for (const message of decoded) rendered.set(message.id, message);
    if (!reconnect) nextBefore = cursor;
    historyLoaded = true;
    setChatState(rendered.size ? '' : 'Henüz mesaj yok. İlk mesajı yazın.');
    renderMessages(before ? 'anchor' : reconnect ? 'follow' : 'bottom');
  } finally {
    if (token === generation) {
      loading = false;
      older.disabled = writingOlder.disabled = false;
      updateComposer();
    }
  }
}

async function joinSelected(reconnect = false) {
  const token = ++generation;
  joined = false;
  loading = true;
  updateComposer();
  setChatState('Mesajlar yükleniyor…');
  try {
    await emit('join', { conversationId: selected.id });
    if (token !== generation) return;
    await loadHistory({ reconnect });
    if (token === generation) joined = true;
  } catch {
    if (token === generation) setChatState('Sohbet yüklenemedi. Sohbeti yeniden seçin.');
  } finally {
    if (token === generation) {
      loading = false;
      updateComposer();
    }
  }
}

function displayChat() {
  document.querySelector('#chat-empty').hidden = Boolean(selected);
  document.querySelector('#chat-body').hidden = !selected;
  const name = selected ? chatName(selected) : 'Mesajlaşma';
  const avatar = document.querySelector('#chat-avatar');
  document.querySelector('#chat-title').textContent = name;
  avatar.hidden = !selected;
  avatar.textContent = selected ? initials(name) : '';
  const writingLink = document.querySelector('#show-writing');
  writingLink.hidden = !selected;
  writingLink.href = selected ? `#writing/${selected.id}` : '#chats';
}

function selectChat(chat) {
  if (chat?.id === selected?.id) return;
  if (selected) emit('typing', { conversationId: selected.id, active: false }).catch(() => {});
  generation++;
  joined = loading = historyLoaded = false;
  selected = chat;
  pending = nextBefore = null;
  messageBox.value = '';
  rendered.clear();
  writers.clear();
  showWriters();
  setChatState('');
  displayChat();
  renderChats();
  renderMessages();
  updateComposer();
  if (selected && socket?.connected) void joinSelected();
}

function updateSecurity(route, chat) {
  if (securityRoute !== route) {
    securityRoute = route;
    securityOperation = null;
    securityStatus.textContent = '';
    fingerprintOutput.hidden = true;
    fingerprintOutput.textContent = '';
  }
  securityChat = chat;
  securitySelect.replaceChildren(new Option('Sohbet seçin', ''), ...chats.map(item => new Option(chatName(item), item.id)));
  securitySelect.value = chat?.id ?? '';
  document.querySelector('#security-conversation').textContent = chat
    ? `${chatName(chat)} sohbetindeki üyelerin parmak izlerini karşılaştırın.`
    : route.id ? 'Sohbet bilgisi bekleniyor veya bu sohbet erişilebilir değil.' : 'Doğrulamak istediğiniz sohbeti seçin.';
  verifyKeys.disabled = !chat || Boolean(securityOperation);
  ownKey.disabled = resetKey.disabled = Boolean(securityOperation);
}

function syncRoute() {
  if (!workspaceRoute || !keyring) return;
  const route = workspaceRoute;
  const { name, id } = route;
  const chat = id && chats.find(item => item.id === id);
  if (name === 'chats') selectChat(chat || null);
  if (name === 'writing' && chat) selectChat(chat);

  const writingChat = name === 'writing' && chat;
  const nextWritingRoute = writingChat ? route : null;
  if (writingRoute !== nextWritingRoute) {
    writingRoute = nextWritingRoute;
    setWritingContext(writingChat ? { conversationId: id, ring: keyring, messages: rendered, api } : null);
  }
  writingOlder.hidden = !writingChat || !nextBefore;
  if (name === 'writing') {
    document.querySelector('#writing-conversation').textContent = writingChat ? chatName(chat) : '';
    document.querySelector('#writing-back').href = writingChat ? `#chats/${id}` : '#chats';
    if (!writingChat) writingHistory.textContent = 'Sohbet bilgisi bekleniyor veya bu sohbet erişilebilir değil.';
    else writingHistory.textContent = chatState.textContent;
  }
  if (name === 'chats' && id && !chat) {
    document.querySelector('#chat-empty h2').textContent = 'Sohbet bekleniyor';
    document.querySelector('#chat-empty p').textContent = 'Sohbet erişilemiyorsa listeyi yenileyin.';
  } else {
    document.querySelector('#chat-empty h2').textContent = 'Sohbet seçin';
    document.querySelector('#chat-empty p').textContent = 'Mesajları görmek için listeden bir sohbet açın.';
  }
  document.querySelector('#show-security').href = selected ? `#security/${selected.id}` : '#security';
  if (name === 'security') updateSecurity(route, chat);
  else if (securityRoute) {
    securityRoute = securityChat = securityOperation = null;
    securityStatus.textContent = fingerprintOutput.textContent = '';
    fingerprintOutput.hidden = true;
  }
  if (id && !chat && requestedRoute !== route) {
    requestedRoute = route;
    void loadChats().catch(() => {});
  }
}

window.addEventListener('workspace-route', syncRoute);

window.addEventListener('account-change', event => {
  const ring = event.detail ? new Keyring(event.detail.id, api) : null;
  keyring = ring;
  ready = false;
  keyReady = ring ? ring.initialize().then(() => {
    if (keyring === ring) { ready = true; updateComposer(); }
  }).catch(err => { if (keyring === ring) showError(err.message); }) : Promise.resolve();

  const previous = socket;
  socket = null;
  previous?.disconnect();
  generation++;
  listRequest++;
  selected = pending = nextBefore = null;
  joined = loading = historyLoaded = false;
  rendered.clear();
  messagesNode.replaceChildren();
  writers.clear();
  showWriters();
  setChatState('');
  chats = [];
  search.value = messageBox.value = '';
  listMessage = 'Sohbetler yükleniyor…';
  older.hidden = true;

  writingRoute = securityRoute = securityOperation = securityChat = requestedRoute = null;
  setWritingContext(null);
  writingOlder.hidden = fingerprintOutput.hidden = true;
  writingHistory.textContent = securityStatus.textContent = fingerprintOutput.textContent = '';
  document.querySelector('#security-conversation').textContent = '';
  document.querySelector('#writing-conversation').textContent = '';
  document.querySelector('#writing-back').href = '#chats';
  document.querySelector('#show-security').href = '#security';
  securitySelect.replaceChildren();
  displayChat();
  renderChats();
  updateComposer();
  if (!ring) return;

  const connection = socket = io();
  connectionStatus.textContent = 'Anlık bağlantı kuruluyor…';
  connection.on('connect', () => {
    connectionStatus.textContent = 'Anlık bağlantı açık.';
    void loadChats().catch(() => {});
    if (selected) void joinSelected(historyLoaded && rendered.size > 0);
  });
  connection.on('disconnect', reason => {
    if (socket !== connection) return;
    writers.clear();
    showWriters();
    connectionStatus.textContent = 'Bağlantı kesildi. Yeniden bağlanılıyor…';
    updateComposer();
    if (reason === 'io server disconnect') {
      connectionStatus.textContent = 'Bağlantı kesildi. Yenileme düğmesiyle yeniden bağlanın.';
      void api('/auth/me').catch(() => {});
    }
  });
  connection.on('connect_error', () => {
    connectionStatus.textContent = 'Sohbet bağlantısı kurulamadı. Yenileme düğmesiyle tekrar deneyin.';
    updateComposer();
    if (!connection.active) void api('/auth/me').catch(() => {});
  });
  connection.on('message', message => {
    void receive(message);
    const chat = chats.find(chat => chat.id === message.conversation_id);
    if (chat && (!chat.last_message_at || new Date(message.created_at) > new Date(chat.last_message_at))) {
      chat.last_message_at = message.created_at;
      const time = [...chatList.querySelectorAll('button')].find(button => button.dataset.chatId === chat.id);
      if (time !== document.activeElement) renderChats();
    }
  });
  connection.on('typing', data => {
    if (data.conversationId !== selected?.id) return;
    if (data.active) writers.set(data.userId, data.username);
    else writers.delete(data.userId);
    showWriters();
  });
});

search.oninput = renderChats;
chatRefresh.onclick = () => {
  if (socket && !socket.connected) socket.connect();
  void loadChats().catch(() => {});
};
document.querySelector('#back-to-chats').onclick = () => { location.hash = 'chats'; };
older.onclick = writingOlder.onclick = async () => {
  if (loading || !nextBefore) return;
  const token = generation;
  try { await loadHistory({ before: nextBefore }); }
  catch { if (token === generation) setChatState('Geçmiş yüklenemedi. Yeniden deneyin.'); }
};
messageBox.onkeydown = event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (!sendButton.disabled) messageForm.requestSubmit();
};
messageBox.oninput = () => {
  pending = null;
  if (selected) emit('typing', { conversationId: selected.id, active: Boolean(messageBox.value.trim()) }).catch(() => {});
};
messageForm.onsubmit = async event => {
  event.preventDefault();
  const content = messageBox.value;
  if (!content.trim() || content.length > 1000) {
    showError('Mesaj 1–1000 karakter olmalı.');
    return;
  }
  const token = generation, conversationId = selected?.id, ring = keyring;
  if (sendButton.disabled || !ring || !conversationId) return;
  sending = true;
  messageBox.readOnly = true;
  updateComposer();
  try {
    // Recheck the directory on retry so identity changes still stop sending.
    const recipients = await ring.recipients(conversationId);
    if (token !== generation) return;
    if (!pending) {
      const clientId = crypto.randomUUID();
      const packet = await encryptMessage(content, conversationId, ring.userId, clientId, recipients);
      if (token !== generation) return;
      pending = { conversationId, packet, clientId };
    }
    const outgoing = pending;
    const result = await emit('message', outgoing);
    await receive(result.message);
    const chat = chats.find(chat => chat.id === conversationId);
    if (ring === keyring && chat) {
      chat.last_message_at = result.message.created_at;
      renderChats();
    }
    if (pending === outgoing) {
      messageBox.value = '';
      pending = null;
    }
  } catch (err) {
    if (token === generation) showError(err.message);
  } finally {
    sending = false;
    messageBox.readOnly = false;
    updateComposer();
  }
};

securitySelect.onchange = () => {
  location.hash = securitySelect.value ? `security/${securitySelect.value}` : 'security';
};

async function runSecurity(action) {
  if (!keyring || securityOperation) return;
  const ring = keyring;
  const token = securityOperation = {};
  const isActive = () => securityOperation === token;
  updateSecurity(securityRoute, securityChat);
  securityStatus.dataset.tone = '';
  securityStatus.textContent = 'İşlem sürüyor…';
  try {
    const message = await action(ring, isActive);
    if (isActive()) {
      securityStatus.textContent = message;
      securityStatus.dataset.tone = 'success';
    }
  } catch (err) {
    if (isActive()) {
      securityStatus.textContent = err.message;
      securityStatus.dataset.tone = 'error';
    }
  } finally {
    if (isActive()) {
      securityOperation = null;
      updateSecurity(securityRoute, securityChat);
    }
  }
}

verifyKeys.onclick = () => {
  const chat = securityChat;
  if (!chat) return;
  return runSecurity(async ring => {
    await ring.recipients(chat.id, true);
    return 'Üye anahtarları bu tarayıcıda onaylandı.';
  });
};
ownKey.onclick = () => runSecurity(async (ring, isActive) => {
  const fingerprint = await ring.ownFingerprint();
  if (isActive()) {
    fingerprintOutput.textContent = fingerprint;
    fingerprintOutput.hidden = false;
  }
  return 'Parmak iziniz gösteriliyor.';
});
resetKey.onclick = () => runSecurity(async (ring, isActive) => {
  if (isActive()) fingerprintOutput.hidden = true;
  await ring.initialize(true);
  await ring.initialize();
  if (keyring === ring) { ready = true; pending = null; updateComposer(); }
  return 'Güncel anahtar bu tarayıcıda hazır.';
});

// Account lookup may have finished before this module and its imports loaded.
if (currentUser) {
  window.dispatchEvent(new CustomEvent('account-change', { detail: currentUser }));
  syncRoute();
}
