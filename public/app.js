const status = document.querySelector('#connection-status');
const error = document.querySelector('#error-message');
const retry = document.querySelector('#retry');

async function checkServer() {
  retry.disabled = true;
  error.hidden = true;
  status.textContent = 'Yükleniyor: sunucu kontrol ediliyor…';
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Sunucu yanıtı başarısız.');
    const health = await response.json();
    if (health.status !== 'ok' || health.stage !== 1) throw new Error('Beklenmeyen sunucu yanıtı.');
    status.textContent = 'Sunucu erişilebilir · Sohbet hizmeti henüz etkin değil.';
  } catch {
    status.textContent = 'Bağlantı yok: sunucuya erişilemiyor veya geçerli yanıt alınamadı.';
    error.textContent = 'Sunucunun çalıştığını ve ağ bağlantınızı kontrol edip yeniden deneyin.';
    error.hidden = false;
  } finally {
    retry.disabled = false;
  }
}

retry.addEventListener('click', checkServer);
window.addEventListener('offline', () => {
  status.textContent = 'Bağlantı yok: tarayıcı çevrimdışı.';
});
window.addEventListener('online', checkServer);
checkServer();
