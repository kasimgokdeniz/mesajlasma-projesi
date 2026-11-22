const connectionStatus = document.querySelector('#connection-status');
const error = document.querySelector('#error-message');
const errorBanner = document.querySelector('#error-banner');
const retry = document.querySelector('#retry');
const form = document.querySelector('#account-form');
const fields = document.querySelector('#account-fields');
const accountStatus = document.querySelector('#account-status');
const submit = document.querySelector('#account-submit');
const authScreen = document.querySelector('#auth-screen');
const chatScreen = document.querySelector('#chat-screen');
const workspaceScreens = [...chatScreen.querySelectorAll('.tool-screen, .conversation')];
const refresh = document.querySelector('#refresh-users');
const refreshGroup = document.querySelector('#refresh-group-users');
const list = document.querySelector('#user-list');
const count = document.querySelector('#user-count');
let currentUser = null;
let sessionChecked = false;
let accountAction;
let workspaceRoute = null;
let users = [], userListState = '', privateRequest = null, groupRequest = null;
const selectedMembers = new Set();
const userSearch = document.querySelector('#user-search');
const group = document.querySelector('#group-form');
const groupName = document.querySelector('#group-name');
const groupFields = document.querySelector('#group-fields');
const groupStatus = document.querySelector('#group-status');
const privateStatus = document.querySelector('#private-status');
const memberError = document.querySelector('#group-members-error');
const routeNotice = document.querySelector('#route-notice');

async function api(path, body) {
  const user = currentUser;
  const response = await fetch(`/api${path}`, {
    cache: 'no-store', signal: AbortSignal.timeout(10000),
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && user && user === currentUser && !['/auth/login', '/auth/register'].includes(path)) {
      showAccount(null);
    }
    throw Object.assign(new Error(data.error || 'İşlem tamamlanamadı.'), { status: response.status });
  }
  return data;
}

function initials(name) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts.at(-1)[0] : [...parts[0]].slice(0, 2).join('')).toLocaleUpperCase('tr-TR');
}

function showError(message) {
  error.textContent = message;
  errorBanner.hidden = false;
}

function fieldError(input, message = '') {
  const feedback = document.querySelector(`#${input.name}-error`);
  feedback.textContent = message;
  feedback.hidden = !message;
  input.setAttribute('aria-invalid', Boolean(message));
}

function renderRoute() {
  if (!sessionChecked) return;
  const requested = location.hash.slice(1);
  const protectedRoute = /^(?:(?:chats|security)(?:\/[1-9][0-9]{0,18})?|writing\/[1-9][0-9]{0,18}|new-chat|new-group|settings)$/.test(requested);
  const route = currentUser ? (protectedRoute ? requested : 'chats') : (requested === 'register' ? 'register' : 'login');
  if (requested !== route) history.replaceState(null, '', `#${route}`);
  authScreen.hidden = Boolean(currentUser);
  chatScreen.hidden = !currentUser;
  if (currentUser) {
    const [name, id] = route.split('/');
    const previous = workspaceRoute;
    if (previous?.name === name && previous?.id === id) return;
    workspaceRoute = { name, id };
    errorBanner.hidden = true;
    routeNotice.hidden = true;
    for (const screen of workspaceScreens) {
      screen.hidden = screen.classList.contains('conversation') ? name !== 'chats' : screen.id !== `${name}-screen`;
    }
    const nav = { 'new-chat': 'show-people', 'new-group': 'show-group', settings: 'show-settings', security: 'show-settings' };
    for (const link of chatScreen.querySelectorAll('.rail a')) {
      if (link.id === (nav[name] ?? 'show-chats')) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    chatScreen.classList.toggle('show-conversation', name === 'chats' && Boolean(id));
    chatScreen.classList.toggle('show-tool', name !== 'chats');
    window.dispatchEvent(new CustomEvent('workspace-route', { detail: workspaceRoute }));
    if (['new-chat', 'new-group'].includes(name) && !users.length) void loadUsers();
    const heading = workspaceScreens.find(screen => !screen.hidden)?.querySelector('h2');
    if (previous && heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    return;
  }
  if (route === accountAction) return;

  accountAction = route;
  const register = route === 'register';
  const title = register ? 'Kayıt ol' : 'Giriş yap';
  document.querySelector('#account-title').textContent = submit.textContent = title;
  document.querySelector('#auth-prompt').textContent = register ? 'Zaten hesabınız var mı?' : 'Hesabınız yok mu?';
  const link = document.querySelector('#auth-switch');
  link.textContent = register ? 'Giriş yap' : 'Kayıt ol';
  link.href = register ? '#login' : '#register';
  form.elements.password.autocomplete = register ? 'new-password' : 'current-password';
  form.elements.password.value = '';
  for (const input of [form.elements.username, form.elements.password]) fieldError(input);
  accountStatus.textContent = '';
}

function showAccount(user) {
  const changed = currentUser?.id !== user?.id;
  currentUser = user;
  if (changed) {
    workspaceRoute = null;
    errorBanner.hidden = routeNotice.hidden = true;
    error.textContent = routeNotice.textContent = '';
    users = [];
    userListState = '';
    privateRequest = groupRequest = null;
    list.inert = false;
    groupFields.disabled = false;
    refresh.disabled = refreshGroup.disabled = false;
    group.reset();
    selectedMembers.clear();
    userSearch.value = '';
    privateStatus.textContent = groupStatus.textContent = memberError.textContent = '';
    memberError.hidden = true;
    fieldError(groupName);
    renderUsers();
    renderGroupUsers();
    const avatar = document.querySelector('#account-avatar');
    avatar.textContent = document.querySelector('#settings-avatar').textContent = user ? initials(user.username) : '';
    avatar.title = document.querySelector('#settings-username').textContent = user?.username ?? '';
    window.dispatchEvent(new CustomEvent('account-change', { detail: user }));
  }
  renderRoute();
}

function renderMembers() {
  document.querySelector('#selected-members').replaceChildren(...users.filter(user => selectedMembers.has(user.id)).map(user => {
    const chip = document.createElement('li');
    chip.textContent = user.username;
    return chip;
  }));
}

function renderUsers() {
  const query = userSearch.value.trim().toLowerCase();
  const matches = users.filter(user => user.username.toLowerCase().includes(query));
  list.replaceChildren(...matches.map(user => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = initials(user.username);
    button.type = 'button';
    button.dataset.userId = user.id;
    button.append(avatar, document.createTextNode(user.username));
    button.onclick = () => openPrivate(user);
    item.append(button);
    return item;
  }));
  count.textContent = userListState || (matches.length ? `${matches.length} kullanıcı` : 'Eşleşen kullanıcı yok.');
}

function renderGroupUsers() {
  const items = document.querySelector('#group-members');
  items.replaceChildren(...users.map(user => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = user.id;
    box.checked = selectedMembers.has(user.id);
    box.onchange = () => {
      if (box.checked) selectedMembers.add(user.id);
      else selectedMembers.delete(user.id);
      memberError.hidden = true;
      renderMembers();
    };
    label.append(box, document.createTextNode(user.username));
    return label;
  }));
  if (userListState) items.textContent = userListState;
  else if (!users.length) items.textContent = 'Henüz başka kullanıcı yok.';
  renderMembers();
}

async function loadUsers() {
  const user = currentUser;
  if (!user || refresh.disabled) return;
  refresh.disabled = refreshGroup.disabled = true;
  userListState = 'Liste yükleniyor…';
  renderUsers();
  if (!users.length) renderGroupUsers();
  try {
    const data = await api('/users');
    if (user !== currentUser) return;
    users = data.users;
    userListState = '';
  } catch (err) {
    if (user !== currentUser) return;
    userListState = 'Kullanıcı listesi alınamadı. Yeniden deneyin.';
  } finally {
    if (user === currentUser) {
      refresh.disabled = refreshGroup.disabled = false;
      renderUsers();
      renderGroupUsers();
    }
  }
}

function openCreatedChat(id, message) {
  location.hash = `chats/${id}`;
  renderRoute();
  routeNotice.textContent = message;
  routeNotice.hidden = false;
}

async function openPrivate(person) {
  if (privateRequest) return;
  const user = currentUser;
  const route = workspaceRoute;
  const token = privateRequest = {};
  list.inert = true;
  privateStatus.dataset.tone = '';
  privateStatus.textContent = 'Sohbet açılıyor…';
  try {
    const { id } = await api('/conversations', { kind: 'private', userId: person.id });
    if (user === currentUser && route === workspaceRoute) openCreatedChat(id, `${person.username} ile sohbet açıldı.`);
  } catch (err) {
    if (user === currentUser) {
      privateStatus.dataset.tone = 'error';
      privateStatus.textContent = err.message;
    }
    return;
  } finally {
    if (privateRequest === token) {
      privateRequest = null;
      list.inert = false;
    }
  }
  if (user === currentUser) privateStatus.textContent = '';
}

group.onsubmit = async event => {
  event.preventDefault();
  if (groupRequest) return;
  const name = groupName.value.trim();
  fieldError(groupName, name.length >= 1 && name.length <= 100 ? '' : 'Grup adı 1–100 karakter olmalı.');
  const members = users.filter(user => selectedMembers.has(user.id)).map(user => user.id);
  memberError.hidden = members.length >= 2 && members.length <= 99;
  memberError.textContent = members.length > 99 ? 'En fazla 99 kişi seçin.' : 'En az iki kişi seçin.';
  groupStatus.textContent = '';
  if (!memberError.hidden || groupName.getAttribute('aria-invalid') === 'true') {
    if (groupName.getAttribute('aria-invalid') === 'true') groupName.focus();
    else document.querySelector('#group-members input')?.focus();
    return;
  }
  const user = currentUser;
  const route = workspaceRoute;
  const token = groupRequest = {};
  groupFields.disabled = true;
  groupStatus.dataset.tone = '';
  groupStatus.textContent = 'Grup oluşturuluyor…';
  try {
    const { id } = await api('/conversations', { kind: 'group', name, memberIds: members });
    if (user !== currentUser) return;
    group.reset();
    selectedMembers.clear();
    renderGroupUsers();
    groupStatus.textContent = '';
    if (route === workspaceRoute) openCreatedChat(id, `“${name}” grubu oluşturuldu.`);
  } catch (err) {
    if (user === currentUser) {
      groupStatus.dataset.tone = 'error';
      groupStatus.textContent = err.message;
    }
  } finally {
    if (groupRequest === token) {
      groupRequest = null;
      groupFields.disabled = false;
    }
  }
};
groupName.oninput = () => fieldError(groupName);
userSearch.oninput = renderUsers;

async function checkSession() {
  if (retry.disabled) return;
  retry.disabled = true;
  try {
    const { user } = await api('/auth/me');
    showAccount(user);
    retry.hidden = errorBanner.hidden = true;
  } catch (err) {
    retry.hidden = err.status === 401;
    if (!retry.hidden) showError('Sunucuya ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin.');
    else errorBanner.hidden = true;
  } finally {
    retry.disabled = false;
    sessionChecked = true;
    document.querySelector('#startup').hidden = true;
    renderRoute();
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (fields.disabled || currentUser) return;
  const { username, password } = form.elements;
  const action = accountAction;
  fieldError(username, /^[a-zA-Z0-9_]{3,32}$/.test(username.value) ? '' : '3–32 harf, rakam veya alt çizgi kullanın.');
  fieldError(password, password.value.length >= 12 && password.value.length <= 128 ? '' : 'Parola 12–128 karakter olmalı.');
  const invalid = form.querySelector('[aria-invalid="true"]');
  if (invalid) { invalid.focus(); return; }

  fields.disabled = true;
  errorBanner.hidden = true;
  accountStatus.textContent = action === 'register' ? 'Hesap oluşturuluyor…' : 'Giriş yapılıyor…';
  try {
    const data = await api(`/auth/${action}`, { username: username.value, password: password.value });
    form.reset();
    accountStatus.textContent = '';
    showAccount(data.user);
  } catch (err) {
    if (accountAction !== action) return;
    if (err.status === 409) {
      fieldError(username, err.message);
      accountStatus.textContent = '';
    } else {
      accountStatus.textContent = err.message;
    }
  } finally {
    fields.disabled = false;
    if (!authScreen.hidden) form.querySelector('[aria-invalid="true"]')?.focus();
  }
});

form.addEventListener('input', event => {
  fieldError(event.target);
  accountStatus.textContent = '';
});
document.querySelector('#logout').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api('/auth/logout', {});
    showAccount(null);
  } catch (err) {
    if (currentUser) showError(err.message);
  } finally {
    button.disabled = false;
  }
});
refresh.onclick = refreshGroup.onclick = loadUsers;
retry.onclick = checkSession;
document.querySelector('#dismiss-error').onclick = () => { errorBanner.hidden = true; };

window.addEventListener('hashchange', renderRoute);
window.addEventListener('online', () => { if (!currentUser) void checkSession(); });
checkSession();
