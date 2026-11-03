const status = document.querySelector('#connection-status');
const error = document.querySelector('#error-message');
const retry = document.querySelector('#retry');
const form = document.querySelector('#account-form');
const fields = document.querySelector('#account-fields');
const accountStatus = document.querySelector('#account-status');
const logout = document.querySelector('#logout');
const refresh = document.querySelector('#refresh-users');
const list = document.querySelector('#user-list');
const count = document.querySelector('#user-count');
const empty = document.querySelector('#users-empty');
let currentUser = null;
async function api(path, body) {
  const response = await fetch(`/api${path}`, {
    cache: 'no-store', signal: AbortSignal.timeout(10000),
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') showAccount(null);
    throw new Error(data.error || 'İşlem tamamlanamadı.');
  }
  return data;
}
function showError(message) { error.textContent = message; error.hidden = false; }
function showAccount(user) {
  currentUser = user;
  window.dispatchEvent(new CustomEvent("account-change", { detail: user }));
  form.hidden = Boolean(user);
  logout.hidden = !user;
  refresh.hidden = !user;
  accountStatus.textContent = user ? `Oturum açık: ${user.username}` : 'Oturum açık değil.';
  list.replaceChildren();
  count.textContent = user ? 'Liste yükleniyor…' : 'Giriş gerekli';
  empty.hidden = Boolean(user);
}
async function loadUsers() {
  refresh.disabled = true;
  count.textContent = 'Liste yükleniyor…';
  try {
    const data = await api('/users');
    list.replaceChildren(...data.users.map(user => {
      const item = document.createElement('li');
      const button = document.createElement("button");
      button.type = "button"; button.textContent = user.username;
      button.onclick = () => window.dispatchEvent(new CustomEvent("open-private", { detail: user }));
      item.append(button);
      return item;
    }));
    count.textContent = `${data.users.length} diğer kullanıcı`;
    window.dispatchEvent(new CustomEvent('users-loaded', { detail: data.users }));
    empty.hidden = data.users.length > 0;
    if (!data.users.length) empty.querySelector('p').textContent = 'Henüz başka kayıtlı kullanıcı yok.';
  } catch (err) { count.textContent = 'Liste alınamadı'; showError(err.message); }
  finally { refresh.disabled = false; }
}
async function checkServer() {
  retry.disabled = true;
  error.hidden = true;
  status.textContent = 'Yükleniyor: sunucu kontrol ediliyor…';
  try {
    const health = await api('/health');
    if (health.status !== 'ok' || health.stage !== 3) throw new Error('Beklenmeyen sunucu yanıtı.');
    status.textContent = 'Sunucu eri\u015filebilir.';
    try {
      const data = await api('/auth/me');
      showAccount(data.user);
      await loadUsers();
    } catch (err) {
      if (currentUser) showError(err.message);
      else if (err.message !== 'Önce giriş yapın.') showError(err.message);
    }
  } catch {
    status.textContent = 'Bağlantı yok: sunucuya erişilemiyor.';
    showError('Sunucuyu ve ağ bağlantınızı kontrol edip yeniden deneyin.');
  } finally { retry.disabled = false; }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const action = event.submitter?.value || 'login';
  fields.disabled = true;
  error.hidden = true;
  accountStatus.textContent = 'İşlem sürüyor…';
  try {
    const data = await api(`/auth/${action}`, { username: form.elements.username.value, password: form.elements.password.value });
    form.reset();
    showAccount(data.user);
    await loadUsers();
  } catch (err) { accountStatus.textContent = 'İşlem başarısız.'; showError(err.message); }
  finally { fields.disabled = false; }
});
logout.addEventListener('click', async () => {
  logout.disabled = true;
  error.hidden = true;
  try { await api('/auth/logout', {}); showAccount(null); }
  catch (err) { showError(err.message); }
  finally { logout.disabled = false; }
});
refresh.addEventListener('click', loadUsers);
retry.addEventListener('click', checkServer);
window.addEventListener('offline', () => { status.textContent = 'Bağlantı yok: tarayıcı çevrimdışı.'; });
window.addEventListener('online', checkServer);
showAccount(null);
checkServer();
