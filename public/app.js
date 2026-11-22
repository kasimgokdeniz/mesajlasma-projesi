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
const people = document.querySelector('#people-dialog');
const refresh = document.querySelector('#refresh-users');
const list = document.querySelector('#user-list');
const count = document.querySelector('#user-count');
const empty = document.querySelector('#users-empty');
let currentUser = null;
let sessionChecked = false;
let accountAction;

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
  const alert = people.open ? document.querySelector('#people-error') : error;
  alert.textContent = message;
  alert.hidden = false;
  if (alert === error) errorBanner.hidden = false;
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
  const route = currentUser ? 'chats' : requested === 'register' ? 'register' : 'login';
  if (requested !== route) history.replaceState(null, '', `#${route}`);
  authScreen.hidden = Boolean(currentUser);
  chatScreen.hidden = !currentUser;
  if (currentUser || route === accountAction) return;

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
  renderRoute();
  if (!changed) return;

  errorBanner.hidden = true;
  people.close();
  list.replaceChildren();
  document.querySelector('#group-members').replaceChildren();
  document.querySelector('#group-form').reset();
  count.textContent = '';
  empty.hidden = true;
  const avatar = document.querySelector('#account-avatar');
  avatar.textContent = user ? initials(user.username) : '';
  avatar.title = user?.username ?? '';
  window.dispatchEvent(new CustomEvent('account-change', { detail: user }));
  if (user) void loadUsers();
}

async function loadUsers() {
  const user = currentUser;
  if (!user) return;
  refresh.disabled = true;
  count.textContent = 'Liste yükleniyor…';
  document.querySelector('#people-error').hidden = true;
  try {
    const data = await api('/users');
    if (user !== currentUser) return;
    list.replaceChildren(...data.users.map(user => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = user.username;
      button.onclick = () => window.dispatchEvent(new CustomEvent('open-private', { detail: user }));
      item.append(button);
      return item;
    }));
    count.textContent = `${data.users.length} diğer kullanıcı`;
    empty.hidden = data.users.length > 0;
    document.querySelector('#group-members').replaceChildren(...data.users.map(user => {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = user.id;
      label.append(box, document.createTextNode(user.username));
      return label;
    }));
  } catch (err) {
    if (user === currentUser) {
      count.textContent = 'Liste alınamadı';
      showError(err.message);
    }
  } finally {
    refresh.disabled = false;
  }
}

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
refresh.onclick = loadUsers;
retry.onclick = checkSession;
document.querySelector('#dismiss-error').onclick = () => { errorBanner.hidden = true; };
document.querySelector('#show-people').onclick = () => {
  document.querySelector('#people-error').hidden = true;
  people.showModal();
};
window.addEventListener('hashchange', renderRoute);
window.addEventListener('online', () => { if (!currentUser) void checkSession(); });
checkSession();
