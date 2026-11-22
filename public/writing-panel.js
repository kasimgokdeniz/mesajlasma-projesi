import { encryptProfile, decryptProfile } from './crypto.js';
import { hasEnoughText, MAX_SAMPLES, MIN_WORDS, verifyAuthor } from './writing-style.js';

const controls = document.querySelector('#writing-controls');
const mode = document.querySelector('#writing-mode');
const button = document.querySelector('#writing-action');
const status = document.querySelector('#writing-status');
const profileStatus = document.querySelector('#writing-profile');
const selectionStatus = document.querySelector('#writing-selection');
const instructions = document.querySelector('#writing-instructions');
const messageList = document.querySelector('#writing-messages');
const dateTime = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
const selection = new Set();
let context, operation, profileRevision = 0;

function report(message, tone = '') {
  status.textContent = message;
  status.dataset.tone = tone;
}

function reportSelection() {
  selectionStatus.textContent = `${selection.size} / ${MAX_SAMPLES} mesaj seçildi.`;
}

function resetSelection() {
  operation = null;
  selection.clear();
  const save = mode.value === 'profile';
  button.disabled = false;
  mode.disabled = false;
  button.textContent = save ? 'Profili kaydet' : 'Seçimi analiz et';
  instructions.textContent = save
    ? 'Size ait, yazarı bilinen mesajları örnek olarak seçin.'
    : 'Profil örneklerinden sonra yazılmış mesajları tek bir gönderenden seçin.';
  instructions.textContent += ` En az iki mesaj ve toplam ${MIN_WORDS} kelime gerekli.`;
  report('');
  reportSelection();
  renderWritingMessages();
}

export function setWritingContext(value) {
  context = value;
  controls.hidden = !context;
  mode.value = 'analysis';
  profileStatus.textContent = '';
  resetSelection();
  if (!context) return;
  const active = context;
  const revision = profileRevision;
  profileStatus.textContent = 'Profil durumu yükleniyor…';
  active.api(`/conversations/${active.conversationId}/writing-profiles/${active.ring.userId}`).then(({ profile }) => {
    if (context === active && revision === profileRevision) showProfile(profile);
  }).catch(() => {
    if (context === active && revision === profileRevision) profileStatus.textContent = 'Profil durumu alınamadı.';
  });
}

function showProfile(profile) {
  profileStatus.textContent = profile
    ? `Bu sohbette yazım profiliniz var${profile.updated_at ? ` · ${dateTime.format(new Date(profile.updated_at))}` : ''}.`
    : 'Bu sohbette henüz yazım profiliniz yok.';
}

export function renderWritingMessages() {
  if (!context) {
    messageList.replaceChildren();
    return;
  }
  const save = mode.value === 'profile';
  const all = [...context.messages.values()].filter(message => message.encrypted_content && (!save || message.sender_id === context.ring.userId));
  const ordered = all.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
  const focused = document.activeElement?.dataset.messageId;
  messageList.replaceChildren(...ordered.map(message => {
    const entry = document.createElement('label');
    const box = document.createElement('input');
    const heading = document.createElement('strong');
    const content = document.createElement('span');
    entry.className = 'writing-message';
    heading.textContent = `${message.username} · ${dateTime.format(new Date(message.created_at))}`;
    content.textContent = message.decrypted ? message.content : 'Analiz için bu mesajın yerel anahtarı gerekir.';
    box.type = 'checkbox';
    box.dataset.messageId = message.id;
    box.disabled = !message.decrypted || Boolean(operation);
    box.checked = selection.has(message.id);
    box.onchange = () => {
      if (box.checked && selection.size >= MAX_SAMPLES) {
        box.checked = false;
        report(`En fazla ${MAX_SAMPLES} mesaj seçebilirsiniz.`, 'error');
        return;
      }
      if (box.checked) selection.add(message.id);
      else selection.delete(message.id);
      report('');
      reportSelection();
    };
    const text = document.createElement('span');
    text.append(heading, content);
    entry.append(box, text);
    return entry;
  }));
  if (!ordered.length) messageList.textContent = 'Seçilebilecek mesaj yok.';
  if (focused) messageList.querySelector(`[data-message-id="${focused}"]`)?.focus({ preventScroll: true });
}

mode.onchange = resetSelection;
button.onclick = async () => {
  if (!context || operation) return;
  const token = operation = {};
  const { messages, ring, conversationId, api } = context;
  const save = mode.value === 'profile';
  const selected = [...selection].map(id => messages.get(id)).filter(m => m?.decrypted && m.encrypted_content);
  const samples = selected.map(m => ({ id: m.id, text: m.content }));
  const owner = selected[0]?.sender_id;
  const show = (message, tone) => { if (operation === token) report(message, tone); };
  button.disabled = mode.disabled = true;
  try {
    if (!samples.length) return show('Örnek yok. Açılmış mesajları seçin.', 'error');
    if (selected.some(m => m.sender_id !== owner) || (save && owner !== ring.userId)) {
      return show(save ? 'Yalnızca kendi mesajlarınızı seçin.' : 'Tek bir gönderenin mesajlarını seçin.', 'error');
    }
    if (!hasEnoughText(samples)) return show(`Yetersiz metin. En az iki mesaj ve toplam ${MIN_WORDS} kelime seçin.`, 'error');
    show('İşlem sürüyor…');
    renderWritingMessages();
    const path = `/conversations/${conversationId}/writing-profiles/${owner}`;
    if (save) {
      const recipients = await ring.recipients(conversationId);
      if (operation !== token) return;
      const packet = await encryptProfile(samples, conversationId, owner, recipients);
      if (operation !== token) return;
      const profile = await api(path, { packet });
      if (operation === token) {
        profileRevision++;
        showProfile(profile);
      }
      show('Yazım profili kaydedildi.', 'success');
    } else {
      const { profile } = await api(path);
      if (!profile) return show('Örnek yok. Gönderen bu sohbet için henüz profil oluşturmadı.', 'error');
      const examples = await decryptProfile(profile.encrypted_profile, conversationId, owner, ring.userId, await ring.keys());
      const { status: result } = verifyAuthor(examples, samples);
      show({
        match: 'Uyum. İletilerin yazımı örnek profile benziyor.',
        difference: 'Farklılık. İletilerin yazımı örnek profilden farklı.',
        insufficient: 'Yetersiz metin. Değerlendirme için daha fazla metin seçin.',
      }[result], result === 'match' ? 'success' : '');
    }
  } catch (error) {
    show(`İşlem tamamlanamadı. ${error.message}`, 'error');
  } finally {
    if (operation === token) {
      operation = null;
      button.disabled = mode.disabled = false;
      renderWritingMessages();
    }
  }
};
