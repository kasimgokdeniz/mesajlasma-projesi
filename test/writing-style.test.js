import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAuthor } from '../public/writing-style.js';

const examples = [
  { id: '1', text: 'selam, bugün toplantı için hazırlık yapıyorum. dosyaları tek tek kontrol edip sana birazdan haber veririm. eksik kalan belgeleri de akşam tamamlarım.' },
  { id: '2', text: 'selam, yarınki toplantı için notlara bakıyorum. belgeleri sabah yanımda getiririm. erken gelirsen birlikte bir kahve içeriz, başka bir şey gerekirse yaz.' },
];

const cases = [
  ['Aynı kurmaca yazar, gündelik plan', true, 'match', [
    'selam, bugün belgeleri göndermeden önce son bir kontrol yaparım. toplantıda konuşacağımız konuları da listeye ekledim, akşam eve gidince sana haber veririm.',
    'yarın sabah erken gelirim, toplantıdan önce kahve alırım. kalan dosyaları yanımda getiriyorum. bir şey eksik olursa bana yaz, birlikte hallederiz.',
  ]],
  ['Başka kurmaca yazar, yoğun vurgu', false, 'difference', [
    'HEY!!! NE VAR??? BAK BAK BAK!!! GEL DE GÖR!!! BEN BURDA SEN NERDE??? HAYDİ HAYDİ HAYDİ!!! DUR YOK YOK YOK!!!',
    'TAMAM!!! HADİ GİT GEL GİT GEL!!! NE DEDİN??? KİM VAR KİM VAR??? AL AL AL!!! BAK BAK BAK!!! HEY HEY HEY!!!',
  ]],
  ['Aynı kurmaca yazar, duyuru biçimi', true, 'difference', [
    'DUYURU: BUGÜN TOPLANTI VAR! HERKES GELSİN! GEÇ KALAN OLUR MU? BELGELER YANINIZDA MI? LÜTFEN SAATİNDE GELİN! ÖNCE BEN KONUŞACAĞIM! SONRA SIRA SİZDE!',
    'HATIRLATMA: YARIN ERKEN GELİN! PLAN DEĞİŞTİ Mİ? HAYIR! TOPLANTI BİTİNCE KALIN! KİM KAHVE İSTER? ÖNCE ŞU DOSYALARI GETİRİN! TEŞEKKÜR EDERİM!',
  ]],
  ['Başka kurmaca yazar, benzer bağlam ve dil', false, 'match', [
    'selam, bugün toplantıya gelirken dosyaları ve defterimi getiriyorum. belgeler hazır olunca sana haber veririm, böylece toplantı başlamadan hepsini birlikte kontrol ederiz.',
    'yarın sabah biraz erken gelirsen kahve içeriz. akşam kalan notları gönderirim, sen de dosyaları kontrol edersin. başka bir şey gerekirse bana yaz.',
  ]],
];

test('Ayrı kurmaca metinlerde uyum, farklılık, yanlış uyarı ve kaçırılan farklılık', t => {
  for (const [label, sameAuthor, expected, texts] of cases) {
    const result = verifyAuthor(examples, texts.map((text, i) => ({ id: String(i + 3), text })));
    t.diagnostic(`${label} | beklenen ilişki: ${sameAuthor ? 'aynı' : 'farklı'} | ${result.status} | ${result.distance.toFixed(3)}`);
    assert.equal(result.status, expected, label);
  }
});

test('Kısa metin ve tek mesaj yetersiz, örnek mesajlar değerlendirmeye alınamaz', () => {
  assert.deepEqual(verifyAuthor(examples, [{ id: '3', text: 'selam' }, { id: '4', text: 'merhaba' }]), { status: 'insufficient' });
  assert.deepEqual(verifyAuthor(examples, [{ id: '3', text: examples.map(item => item.text).join(' ') }]), { status: 'insufficient' });
  assert.throws(() => verifyAuthor(examples, examples), /sonra/);
  assert.throws(() => verifyAuthor(examples, [examples[0], examples[0]]), /Geçersiz/);
});
