import { encryptMessage, decryptMessage } from './crypto.js';
import { setWritingContext, writingChoice } from './writing-panel.js';
import { Keyring } from './keyring.js';

const chatState = document.querySelector('#chat-state');
const messageBox = document.querySelector('#message');
const messageForm = document.querySelector('#message-form');
const sendButton = document.querySelector('#send');
const messagesNode = document.querySelector('#messages');
const scroller = document.querySelector('#message-scroll');
const older = document.querySelector('#older');
const groupForm = document.querySelector('#group-form');
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
  older.hidden = !nextBefore;
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
    const choice = writingChoice(message);
    if (choice) article.append(choice);
    nodes.set(message.id, article);
    fragment.append(article);
  }
  const focusedMessage = document.activeElement?.dataset.messageId;
  messagesNode.replaceChildren(fragment);
  if (follow) scroller.scrollTop = scroller.scrollHeight;
  else if (anchor && nodes.has(anchor.dataset.id)) scroller.scrollTop += nodes.get(anchor.dataset.id).getBoundingClientRect().top - offset;
  if (focusedMessage) nodes.get(focusedMessage)?.querySelector('input')?.focus({ preventScroll: true });
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
    button.onclick = () => { void selectChat(chat); };
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
    if (request === listRequest) renderChats();
  }
}

async function loadHistory({ before = null, reconnect = false } = {}) {
  const token = generation;
  const conversationId = selected.id;
  const ring = keyring, readiness = keyReady;
  loading = true;
  older.disabled = true;
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
      older.disabled = false;
      updateComposer();
    }
  }
}

async function joinSelected(reconnect = false) {
  const token = ++generation;
  joined = false;
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
    if (token === generation) updateComposer();
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
  document.querySelector('#verify-keys').disabled = !selected;
  setWritingContext(selected ? { conversationId: selected.id, ring: keyring, messages: rendered, api } : null, renderMessages);
}

async function selectChat(chat) {
  document.querySelector('#chat-screen').classList.add('show-conversation');
  people.close();
  if (chat.id === selected?.id && joined) return;
  if (selected) emit('typing', { conversationId: selected.id, active: false }).catch(() => {});
  selected = chat;
  pending = null;
  messageBox.value = '';
  rendered.clear();
  writers.clear();
  showWriters();
  older.hidden = true;
  nextBefore = null;
  historyLoaded = false;
  displayChat();
  for (const button of chatList.querySelectorAll('button')) {
    if (button.dataset.chatId === chat.id) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
  await joinSelected();
}

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
  writers.clear();
  showWriters();
  chats = [];
  search.value = messageBox.value = '';
  listMessage = 'Sohbetler yükleniyor…';
  older.hidden = true;
  document.querySelector('#chat-screen').classList.remove('show-conversation');
  document.querySelector('#security-panel').open = false;
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

async function createChat(body) {
  const ring = keyring;
  const { id } = await api('/conversations', body);
  if (ring !== keyring) return;
  search.value = '';
  await loadChats();
  const chat = chats.find(chat => chat.id === id);
  if (ring === keyring && chat) await selectChat(chat);
}

window.addEventListener('open-private', event => {
  void createChat({ kind: 'private', userId: event.detail.id }).catch(err => showError(err.message));
});
groupForm.onsubmit = async event => {
  event.preventDefault();
  const button = groupForm.querySelector('button');
  button.disabled = true;
  try {
    await createChat({
      kind: 'group',
      name: document.querySelector('#group-name').value,
      memberIds: [...groupForm.querySelectorAll('input:checked')].map(input => input.value),
    });
    groupForm.reset();
  } catch (err) { showError(err.message); }
  finally { button.disabled = false; }
};
search.oninput = renderChats;
chatRefresh.onclick = () => {
  if (socket && !socket.connected) socket.connect();
  void loadChats().catch(() => {});
};
document.querySelector('#show-chats').onclick = document.querySelector('#back-to-chats').onclick = () => {
  document.querySelector('#chat-screen').classList.remove('show-conversation');
  search.focus();
};
older.onclick = async () => {
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

document.querySelector('#verify-keys').onclick = async () => {
  const token = generation;
  try {
    if (!selected || !keyring) throw new Error('Önce sohbet seçin.');
    await keyring.recipients(selected.id, true);
    if (token === generation) {
      errorBanner.hidden = true;
      document.querySelector('#security-panel').open = false;
      setChatState('Üye anahtarları bu tarayıcıda onaylandı.');
    }
  } catch (err) { if (token === generation) showError(err.message); }
};
document.querySelector('#own-key').onclick = async () => {
  try {
    if (!keyring) throw new Error('Önce giriş yapın.');
    window.alert(`Kendi anahtar parmak iziniz:\n${await keyring.ownFingerprint()}\nBunu diğer üyelerle güvenilir kanaldan karşılaştırın.`);
  } catch (err) { showError(err.message); }
};
document.querySelector('#reset-key').onclick = async () => {
  try {
    if (!keyring) throw new Error('Önce giriş yapın.');
    const ring = keyring;
    await ring.initialize(true);
    await ring.initialize();
    if (keyring === ring) { ready = true; pending = null; updateComposer(); }
  } catch (err) { showError(err.message); }
};

// Account lookup may have finished before this module and its imports loaded.
if (currentUser) window.dispatchEvent(new CustomEvent('account-change', { detail: currentUser }));
