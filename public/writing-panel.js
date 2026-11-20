import { encryptProfile, decryptProfile } from './crypto.js';
import { hasEnoughText, MAX_SAMPLES, MIN_WORDS, verifyAuthor } from './writing-style.js';

const panel = document.querySelector('#writing-panel');
const mode = document.querySelector('#writing-mode');
const button = document.querySelector('#writing-action');
const status = document.querySelector('#writing-status');
const selection = new Set();
let context, redraw, operation = null;

function resetSelection() {
  operation = null;
  selection.clear();
  button.disabled = false;
  button.textContent = mode.value === 'profile' ? 'Profili oluştur veya güncelle' : 'Seçimi analiz et';
  status.textContent = '';
  redraw();
}

export function setWritingContext(value, render) {
  context = value;
  redraw = render;
  panel.hidden = !value;
  panel.open = false;
  mode.value = 'analysis';
  resetSelection();
}

export function writingChoice(message) {
  if (!context || !panel.open || !message.encrypted_content) return null;
  if (!message.decrypted) {
    const note = document.createElement('small');
    note.textContent = 'Analiz için mesajın anahtarı gerekir.';
    return note;
  }
  if (mode.value === 'profile' && message.sender_id !== context.ring.userId) return null;
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.dataset.messageId = message.id;
  box.checked = selection.has(message.id);
  box.onchange = () => {
    if (box.checked && selection.size >= MAX_SAMPLES) {
      box.checked = false;
      status.textContent = 'En fazla 8 mesaj seçebilirsiniz.';
      return;
    }
    if (box.checked) selection.add(message.id);
    else selection.delete(message.id);
    status.textContent = `${selection.size} mesaj seçildi.`;
  };
  label.append(box, document.createTextNode('Yazım analizi için seç'));
  return label;
}

mode.onchange = resetSelection;
panel.ontoggle = () => { if (redraw) redraw(); };

button.onclick = async () => {
  if (!context || operation) return;
  const token = {};
  operation = token;
  const { messages, ring, conversationId, api } = context;
  const save = mode.value === 'profile';
  const selected = [...selection].map(id => messages.get(id)).filter(m => m?.decrypted && m.encrypted_content);
  const samples = selected.map(m => ({ id: m.id, text: m.content }));
  const owner = selected[0]?.sender_id;
  const report = message => { if (operation === token) status.textContent = message; };
  button.disabled = true;
  try {
    if (!samples.length) return report('Örnek yok. Açılmış mesajları seçin.');
    if (selected.some(m => m.sender_id !== owner) || (save && owner !== ring.userId)) {
      return report(save ? 'Yalnızca kendi mesajlarınızı seçin.' : 'Tek bir gönderenin mesajlarını seçin.');
    }
    if (!hasEnoughText(samples)) return report(`Yetersiz metin. En az iki mesaj ve toplam ${MIN_WORDS} kelime seçin.`);
    report('Yükleniyor…');
    const path = `/conversations/${conversationId}/writing-profiles/${owner}`;
    if (save) {
      const recipients = await ring.recipients(conversationId);
      if (operation !== token) return;
      const packet = await encryptProfile(samples, conversationId, owner, recipients);
      if (operation !== token) return;
      await api(path, { packet });
      report('Yazım profili kaydedildi.');
    } else {
      const { profile } = await api(path);
      if (!profile) return report('Örnek yok. Gönderen bu sohbet için henüz profil oluşturmadı.');
      const examples = await decryptProfile(profile.encrypted_profile, conversationId, owner, ring.userId, await ring.keys());
      const { status: result } = verifyAuthor(examples, samples);
      report({ match: 'Uyum', difference: 'Farklılık', insufficient: 'Yetersiz metin' }[result]);
    }
  } catch (error) {
    report(`İşlem tamamlanamadı. ${error.message}`);
  } finally {
    if (operation === token) {
      operation = null;
      button.disabled = false;
    }
  }
};
