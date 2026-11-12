# Web Tabanlı Anlık Mesajlaşma Uygulaması

Özel ve grup sohbetleri, geçmiş, tekrar gönderim koruması ve yazıyor göstergesiyle birlikte tarayıcıda uçtan uca mesaj şifreleme desteklenir. Yazar analizi bu sürümün kapsamında değildir.

## Kurulum ve çalıştırma

Node.js 22.9+, PostgreSQL ve güncel masaüstü Chrome/Edge gerekir. PowerShell:

```powershell
npm.cmd ci
# Yalnızca yerel ayar dosyası henüz yoksa:
Copy-Item .env.example .env
npm.cmd run migrate
npm.cmd run migrate:test
npm.cmd test
npm.cmd run dev
```

Mevcut yerel ayar dosyasının üzerine kopyalamayın. PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, ayrı TEST_PGDATABASE ve en az 32 karakterlik rastgele SESSION_SECRET ayarlayın. Sırları sürüm kontrolüne eklemeyin. Varsayılan adres http://127.0.0.1:3000; izlemesiz başlatma `npm.cmd start`, durdurma Ctrl+C. Veritabanı kapalıyken arayüz açılır ancak veri işlemleri hata verir; `/api/health` yalnızca HTTP durumudur.

Veritabanları önceden oluşturulmalıdır; migration CREATE DATABASE yapmaz, mevcut mesajları silmez. Uygulama kullanıcısına veritabanında CONNECT, hedef şemada USAGE/CREATE gerekir. TEST_PGDATABASE eksikse veya PGDATABASE ile aynıysa test bağlantısı reddedilir. Test temizliği yalnızca oluşturulan rastgele hesap/sohbet kimlikleri üzerinde çalışır.

## Kullanım ve anahtar doğrulama

Her hesap kendi tarayıcısında bir kez giriş yaparak açık anahtarını yayımlamalıdır. Kişiyi seçerek özel sohbet açın; grup için kurucunun yanında en az iki başka kullanıcı seçin. Grup adı 1–100 karakter, toplam üye sayısı en fazla 100'dür. Diğer üyeler sohbet listesini yenileyebilir. Üyelik düzenleme bu sürümde yoktur.

Göndermeden önce **Kendi parmak izim** ile her üye kendi SHA-256 parmak izini görür. **Üye anahtarlarını doğrula** ekranındaki değerleri yüz yüze veya başka güvenilir kanaldan her üyenin kendi ekranıyla karşılaştırın; ancak eşleşiyorsa onaylayın. İlk anahtar sunucudan gelir ve kendiliğinden güvenilir değildir. Karşılaştırmasız onay kimlik doğrulaması sağlamaz. Onay hesap bazında bu tarayıcıda saklanır. Bir üyenin anahtarı eksikse gönderim durur. Parmak izi değişirse yeniden açıkça doğrulanana kadar gönderim durur; ekranda DEĞİŞTİ uyarısı görünür. Geçmişin çözülebilmesi, gönderenin kimliğinin bağımsız doğrulandığı anlamına gelmez.

Mesajlar 1–1000 JavaScript karakter birimi olmalıdır; boş metin reddedilir. Sunucu şifreli metnin açık uzunluğunu bilemez: bu sınır gönderen ve alıcı istemcide, şifreli veri boyutu sunucuda denetlenir. Metin `textContent` ile gösterilir. Başarısız gönderimde metni değiştirmeden tekrar deneyin; aynı şifreli paket ve gönderim kimliği korunur. Yenileme başarısız taslağı korumaz.

Geçmiş son 50 mesajla açılır; **Önceki mesajlar** eski sayfaları getirir. Yeniden bağlantıda geçmiş tekrar yüklenir, mesaj kimliğine göre birleştirilir. Yazıyor bilgisi ilgili sohbet üyelerine gider; üç saniye hareketsizlik, gönderim, sohbet değiştirme veya kopmada temizlenir. Grup adı, üyelik, gönderen, zamanlar ve yazıyor bilgisi sunucudan gizlenmez.

## Şifreleme ve yerel anahtar ömrü

Her mesaj için Web Crypto ile bağımsız 256 bit AES-GCM anahtarı ve rastgele 96 bit IV üretilir; aynı AES anahtarıyla ikinci şifreleme yapılmaz. Tekrar gönderimler aynı paketi kullanır. 128 bit doğrulama etiketi ile sürüm, sohbet, gönderen ve gönderim kimliğine bağlı ek doğrulama verisi kullanılır. AES anahtarı, gönderen dahil güncel üyelerin her biri için RSA-OAEP-2048/SHA-256 ile ayrı zarflanır. Zarflar mesaj paketinin içinde saklanır; önceki şemanın `key_envelopes` tablosu kullanılmaz. Üye sayısı arttıkça paket ve şifreleme maliyeti artar.

RSA özel anahtarları, hesap kimliğiyle ayrılmış IndexedDB kayıtlarında dışa aktarılamayan CryptoKey olarak saklanır. Sunucuya yalnızca açık RSA anahtarının kty/n/e alanları, şifreli anahtar zarfları ve şifreli mesaj paketleri gönderilir. Anahtar oluşturma/yayımlama ve güven kayıtları sekmeler arasında tarayıcı kilidiyle sıralanır. Oturum kapatmak anahtarları silmez; aynı köken, tarayıcı profili ve hesapla yeniden giriş geçmişi açar. Ortak cihazın işletim sistemi veya aynı kökenli zararlı koduna karşı hesap ayrımı koruma sağlamaz.

Tarayıcı verisini silmek, gizli oturumu kapatmak, başka profil/cihaz kullanmak veya adresi/kökeni değiştirmek anahtarı erişilemez hale getirir. Parola anahtarı geri getirmez. Otomatik anahtar değiştirme yapılmaz: **Anahtarı yenile** kayıp ve yeniden doğrulama uyarısı üzerine açık onay ister. Yeni anahtar sonraki mesajlar içindir; kaybolan özel anahtara ait geçmiş kurtarılamaz. Yenileme sırasında mevcut eski yerel anahtarlar varsa korunur. Yedekleme, cihazlar arası anahtar aktarımı ve kurtarma desteği yoktur. Açılamayan veya değiştirilmiş paket hata gösterir; açık metne dönüş yapılmaz.

Önceden açık metin saklanan mesajlar otomatik silinmez veya şifrelenmiş gibi gösterilmez; arayüz bunları **Eski açık metin kaydı (E2EE değil)** etiketiyle gösterir. Yeni gönderim yolu açık metni reddeder. Üçüncü migration eski satırları dönüştürmez; yeni yazımlar için içerik modu kısıtı ekler. Önceden kullanılan format dışı şifreli kayıtlar da açılma hatası verebilir.

## Yerel ağda HTTPS

Web Crypto, IndexedDB ve tarayıcı kilit desteği gerekir. Loopback/localhost geliştirmede HTTP kullanılabilir; başka bilgisayardan `http://LAN_IP:3000` güvenli bağlam değildir ve şifreli gönderim çalışmaz. Üç bilgisayarda güvenilen HTTPS kullanın; sertifika hatasını atlamayın ve tarayıcı güvenliğini devre dışı bırakmayın. HTTP'den HTTPS'ye geçiş yeni kökendir; hesapların o kökende yeniden anahtar oluşturması ve parmak izlerinin yeniden doğrulanması gerekir. Gerçek mesajlaşmaya başlamadan kalıcı HTTPS adresini seçin.

Örnek: sunucuya Caddy kurun ve aşağıdaki Caddyfile'ı depo dışında tutun:

```caddyfile
mesaj.local {
    tls internal
    reverse_proxy 127.0.0.1:3000
}
```

Her bilgisayarın DNS veya hosts kaydında `mesaj.local` sunucunun yerel IP'sine çözülmelidir. Yerel CA'nın **açık kök sertifikasını** her istemcinin ve gerekiyorsa tarayıcının güven deposuna güvenilir yoldan kurun; CA özel anahtarını paylaşmayın. [Yerel sertifika](https://caddyserver.com/docs/caddyfile/directives/tls) ve [ters vekil](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) resmi belgelerine bakın.

Sunucuyu ters vekilin arkasında çalıştırın:

```powershell
$env:HOST='127.0.0.1'
$env:NODE_ENV='production'
npm.cmd start
```

Ayrı terminalde Caddyfile'ın bulunduğu dizinde `caddy run` çalıştırın. Üç cihazda `https://mesaj.local` açın. Güvenlik duvarında yalnızca özel LAN'a TCP 443 izni verin; HTTP yönlendirmesi gerekiyorsa 80'i açın. Node'un 3000 portunu LAN'a açmayın. Üretim modu bir güvenilir ters vekil varsayar, Secure çerez kullanır ve WebSocket HTTPS kaynağını vekilin X-Forwarded-Proto başlığıyla denetler. Node'a doğrudan dış istemci erişimi olan dağıtımlar desteklenmez. Vekil aynı Host bilgisini ve WebSocket trafiğini korumalıdır.

## API ve sunucu denetimleri

| Uç nokta | İşlev |
| --- | --- |
| GET /api/health | HTTP durumu, stage: 4 |
| POST /api/auth/register, /api/auth/login, /api/auth/logout | Hesap/oturum |
| GET /api/auth/me, /api/users | Oturum sahibi / kullanıcı listesi |
| GET /api/keys/me | Kendi güncel açık anahtarı |
| POST /api/keys | Oturumla eşleşen userId, publicKey ve expectedVersion; yeni açık anahtar sürümü |
| GET /api/conversations/:id/keys | Yalnızca üyeye güncel sohbet üyesi anahtarları |
| GET/POST /api/conversations | Sohbet listesi / oluşturma |
| GET /api/conversations/:id/messages?before=ID | Üyelik denetimli geçmiş |

Socket.IO `join {conversationId}`, `typing {conversationId,active}` ve `message {conversationId,clientId,packet}` olaylarını kullanır. Packet v/iv/ciphertext/envelopes; her zarf userId/keyVersion/wrapped içerir. Tüm güncel üyeler için tam birer zarf gerekir. Fazladan alan, özel anahtar alanları, yanlış base64, sürüm, IV/şifreli metin/zarf boyutu veya eksik/üye olmayan alıcı reddedilir. Gönderen sunucudaki oturumdan alınır. Aynı gönderim kimliği farklı pakete atanamaz; birebir tekrar mevcut kaydı döndürür.

HTTP JSON ve Socket.IO paket sınırı 64 KiB'dir; 100 üyeye ayrı RSA zarfı için önceki 8 KiB sınırı artırılmıştır. Şifreli metin en fazla 4016 byte, IV 12 byte, RSA zarfı 256 byte'dır. Açık anahtar yalnızca 2048 bit RSA/65537 kabul edilir. SQL parametrelidir; üyelik ve oturum her olayda, alıcı oturumları yayın öncesinde denetlenir. İptal/süresi dolmuş oturumlar açık bağlantıda da reddedilir. Çapraz kaynak engeli, CSP, HttpOnly/SameSite çerezler korunur. Mesajlar ve anahtarlar loglanmaz. Parolalar tuzlu scrypt özetidir.

## Güvenlik sınırları

Bağımsız güvenlik denetimi yapılmamıştır; standart Web Crypto ilkellerini kullanan uygulamaya özgü protokoldür. İleri gizlilik, Double Ratchet, bağımsız mesaj imzası ve anahtar şeffaflığı yoktur. RSA özel anahtarı ele geçirilirse kaydedilmiş eski zarflar çözülebilir. GCM paket bütünlüğünü ve anahtara sahip olmayı doğrular; kötü niyetli sunucuya karşı bağımsız gönderen kanıtı sağlamaz. Gönderen kimliği için sunucu oturum/erişim denetimine güvenilir.

Parmak izi karşılaştırması anahtar dizinindeki değiştirmeyi fark etmeye yardımcı olur. Sunucu ele geçirilip JavaScript değiştirilirse tarayıcıdaki açık metin ve anahtar işlemleri kötüye kullanılabilir; dışa aktarılamayan anahtar bunu engellemez. XSS, zararlı eklenti, cihaz/işletim sistemi erişimi ve ekran görüntüsü de kapsam dışıdır. HTTPS giriş parolasını, çerezi ve istemci kodu aktarımını korur. Üyeler metni kopyalayabilir; trafik metaverisi gizlenmez. Hız sınırlaması, çok sunuculu dağıtım ve üretim sertleştirmesi yoktur.

## Testler ve manuel kabul

`npm.cmd test` ayrı test veritabanında mevcut hesap/oturum/üyelik, sohbet benzersizliği, yayın, yazıyor zaman aşımı, sayfalama ve tekrar gönderim kontrollerini çalıştırır. Şifreli paket, bozuk veri, açık metin reddi, eksik üye anahtarı, eski kayıt etiketi ve API/veritabanı gizlilik kontrolleri eklenmiştir. Gerçek PostgreSQL/HTTP/Socket.IO ve Web Crypto kullanılır.

Tarayıcı testi geçici, ayrı Chrome/Edge oturumlarında gerçek kayıt formu, özel ve üç üyeli grup gönderimi, parmak izi onayı, yenileme, IndexedDB, anahtar kaybı ve yenilemesini çalıştırır. WebSocket çerçevelerini, geçmiş API'sini ve yeni veritabanı satırlarını açık mesaj/özel anahtar sızıntısı için denetler; özel CryptoKey dışa aktarma girişiminin reddini doğrular. Tarayıcı bulunamazsa test gerekçeyle atlanır; `CHROME_PATH` ile yol verilebilir. Geçici tarayıcı profili test sonunda silinir. Bunlar bağımsız güvenlik denetimi değildir.

Üç fiziksel bilgisayarda manuel kabul:

1. HTTPS kurulumuyla A/B/C hesaplarını ayrı cihazlarda açın, parmak izlerini güvenilir kanaldan karşılaştırın.
2. A/B özel sohbetinde iki yönde mesaj gönderin; C'nin geçmiş, anahtar dizini ve socket erişimi reddedilmeli. Aynı çift için tek sohbet kalmalı.
3. A/B/C grubunda tüm cihazlardan gönderin, iki saniyelik teslim hedefini ölçün. Yazıyor göstergesi yalnızca ilgili sohbette görünmeli ve üç saniye durunca temizlenmeli.
4. Yenileme/yeniden bağlantı ve 50'den fazla mesajla geçmişi açın; yinelenme olmamalı, HTML metin görünmeli. Boş/1001 karakter mesaj reddedilmeli.
5. Yalnızca deneme hesabının ayrı test profilinde yerel veriyi silin: eski mesaj hata göstermeli, gönderim durmalı. Açık onayla anahtarı yenileyin; diğer üyeler yeni parmak izini onaylayana kadar gönderememeli. Yeni mesajlar açılmalı, kayıp anahtara ait eskiler açılmamalı.
6. Başka sekmeden çıkış, ağ kesilmesi ve sunucu/veritabanı durmasını deneyin. Ağ/veritabanında yeni mesaj metni veya özel anahtar bulunmamalı; eski açık metin kayıtları ayrı değerlendirilmelidir.

Fiziksel üç bilgisayarlı test, LAN performans ölçümü ve bu örnek HTTPS dağıtımının uçtan uca kabulü henüz yapılmadı.
