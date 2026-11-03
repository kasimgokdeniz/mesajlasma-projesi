# Web Tabanlı Anlık Mesajlaşma Uygulaması

Hesaplar, PostgreSQL oturumları ve mevcut üç sütunlu arayüz korunarak özel/grup sohbeti, mesaj geçmişi ve yazıyor göstergesi eklendi.

**Yalnızca yerel geliştirme/test içindir. Mesajlar açık metin olarak ağdan geçer ve PostgreSQL'de saklanır; sunucu mesajları okuyabilir. E2EE yoktur.** Şifreleme, anahtar yönetimi ve yazar analizi sonraki aşamalardır. Gerçek özel bilgi kullanmayın. Yerel HTTP hesap parolalarını da ağ üzerinde şifrelemez; güvenilen test ağı ve deneme hesapları kullanın. Bu sürüm internete açık üretim servisi değildir.

## Kurulum ve başlatma

Node.js 22.9+, npm, PostgreSQL ve masaüstü Chrome/Edge gerekir. PowerShell komutları:

```powershell
npm.cmd ci
# Yalnızca .env yoksa:
Copy-Item .env.example .env
npm.cmd run migrate
npm.cmd run migrate:test
npm.cmd test
npm.cmd run dev
```

http://127.0.0.1:3000 adresini açın. İzlemesiz başlatma `npm.cmd start`, durdurma Ctrl+C. HOST varsayılanı 127.0.0.1, PORT 3000. Mevcut `.env` dosyasının üzerine kopyalamayın. PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, TEST_PGDATABASE ve en az 32 karakterlik güvenli rastgele SESSION_SECRET ayarlayın. Ortam değerleri bu aşamada değiştirilmedi; sırları paylaşmayın veya Git'e eklemeyin.

`mesajlasma` ve `mesajlasma_test` veritabanları, `mesajlasma_app` kullanıcısı zaten vardır. Migration veritabanı oluşturmaz; CREATE DATABASE yetkisi gerekmez. Yeni kurulumda PostgreSQL yöneticisi iki ayrı veritabanını oluşturup uygulama kullanıcısına CONNECT ve hedef şemada USAGE/CREATE yetkisi vermelidir. Migration mevcut kayıtları silmez. PostgreSQL kapalıyken HTTP ve arayüz açılır, veri işlemleri anlaşılır genel hatayla sonuçlanır. `/api/health` yalnızca HTTP durumunu gösterir.

## Kullanım

Giriş yaptıktan sonra kişi listesindeki kullanıcıya tıklayın. İki kişi için ters yönde ve eşzamanlı isteklerde de tek özel sohbet kullanılır. Grup adı 1–100 karakter; kurucunun yanında en az iki başka kullanıcı seçilir, toplam en fazla 100 üye desteklenir. Kurucu otomatik üyedir. Grupları görmek için diğer kullanıcılar **Sohbetleri yenile** düğmesine basabilir; yeniden bağlantıda liste de yenilenir.

Mesajlar gönderen ve yerel tarih/saatle gösterilir. Boş veya 1000 JavaScript karakter birimini aşan mesajlar istemcide ve sunucuda reddedilir. İçerik `textContent` ile gösterilir; HTML çalıştırılmaz. Gönderim kimliği tekrar denemelerde aynı tutulur; veritabanı aynı göndericinin aynı kimlikli mesajını ikinci kez kaydetmez. Hata sonrası metni değiştirmeden tekrar gönderilebilir. Sayfa yenilenirse başarısız taslak korunmaz.

Geçmiş son 50 mesajla açılır; **Önceki mesajlar** önceki 50 kaydı getirir. Kimlik imleci kullanılır. Sohbet seçildikten ve odaya katıldıktan sonra geçmiş alınır; gelen olaylar ve geçmiş mesaj kimliğine göre birleştirilir. Bağlantı tekrar kurulduğunda son sayfa yeniden yüklenir; daha eski kayıtlar düğmeyle alınır. Yazıyor bildirimi yalnızca ilgili sohbetin diğer katılımcılarında görünür; sunucu üç saniyelik hareketsizlikte, gönderimde, sohbet değişiminde ve kopmada temizler.

## API, Socket.IO ve güvenlik

| Uç nokta | İşlev |
| --- | --- |
| GET /api/health | HTTP durumu, stage: 3 |
| POST /api/auth/register, /api/auth/login | JSON username/password; hesap ve oturum |
| POST /api/auth/logout | JSON {}; PostgreSQL oturumunu siler |
| GET /api/auth/me, /api/users | Oturum sahibi / diğer kullanıcıların id ve username alanları |
| GET /api/conversations | Yalnızca üye olunan sohbetler |
| POST /api/conversations | Özel: kind/private ve userId; grup: kind/group, name, memberIds |
| GET /api/conversations/:id/messages?before=ID | Üyelik denetimli geçmiş; messages ve nextBefore |

Socket.IO aynı kökendeki oturum çerezini kullanır. `join {conversationId}`, `message {conversationId, content, clientId}` ve `typing {conversationId, active}` olayları onay yanıtı ister: `{ok: true, ...}` veya `{ok: false, error}`. Gönderen istemci paketinden alınmaz. Her olayda PostgreSQL oturumu yeniden yüklenir, kimlik/paket ve üyelik doğrulanır. Yayın öncesi alıcı oturumları da doğrulanır. Açık bağlantılar oturum iptali/süre sonu için saniyede bir kontrol edilir; geçersiz oturumla işlem yapılamaz. Olay sırası asenkron sorgularda korunur. İstemci her seferinde tek sohbet odasına katılır.

SQL parametrelidir. Özel çift için UNIQUE anahtarı; mesaj için `(sender_id, client_id)` UNIQUE indeksi vardır. Mesaj metni veya sırlar loglanmaz. HTTP JSON ve Socket.IO paket sınırı 8 KB'dir. Çapraz kaynak yazma/bağlantı istekleri reddedilir; Socket.IO CORS açılmaz. Parolalar rastgele tuzlu scrypt ile özetlenir. Çerez HttpOnly, SameSite=Lax ve sekiz saat ömürlüdür; üretim ayarı Secure kullanır. HTTPS/ters vekil üretim dağıtımı ve güvenlik denetimi bu aşamanın kapsamı değildir. Giriş/mesaj hız sınırlaması henüz yoktur.

## Dosyalar ve bağımlılıklar

- `server/chat.js`: doğrulama, üyelik, sohbet oluşturma, geçmiş ve mesaj kaydı; HTTP rotaları.
- `server/realtime.js`: ortak oturumla Socket.IO, odalar, olaylar ve yazıyor zaman aşımı.
- `public/app.js`, `public/chat.js`, `index.html`, `styles.css`: mevcut hesap ekranı ve sohbet etkileşimleri.
- `migrations/002_chat.sql`: özel çift ve tekrar gönderim anahtarı, açık metin geliştirme alanı. Eski encrypted_content/key_version alanları korunur ancak bu aşamada kullanılmaz. Anahtar/profil tabloları kullanılmaz.
- `server/migrate.js`: transaction ve advisory lock ile sürümlü, tekrar çalıştırılabilir migration.
- `test/`: gerçek HTTP, PostgreSQL ve Socket.IO kontrolleri.

Mevcut Express, pg, express-session, connect-pg-simple korunmuştur. Yeni `socket.io` gerçek zamanlı iletişim için, yalnızca geliştirme bağımlılığı `socket.io-client` gerçek protokol entegrasyon testleri için gereklidir. Build/lint scripti yoktur.

## Gerçek test sonuçları ve sınırlamalar

`npm.cmd test`: **14 test geçti, 0 başarısız, 0 atlanan**. Hesap/çerez/giriş/çıkış ve erişim testleri korunmuştur. Yeni testlerde dört ayrı hesapla eşzamanlı özel sohbet benzersizliği, grup kurucusu/üyeler, özel ve grup mesaj iletimi, sunucunun göndericiyi belirlemesi, tekrar gönderim, 55 mesajla sayfalama, yeniden bağlantı geçmişi, geçersiz/oturumsuz/çapraz kaynak bağlantı, üye olmayanın geçmiş/join/send/typing reddi, hatalı paket, boş/uzun mesaj, yazıyor zaman aşımı/gönderim/kopma ve açık socket üzerinde çıkış/süresi dolmuş oturum doğrulanır. Her iki migration komutu da gerçekten çalıştırıldı. npm bağımlılık kurulumu denetiminde 0 açık bildirildi.

Testler yalnızca `TEST_PGDATABASE` üzerinden çalışır; eksik veya PGDATABASE ile aynı hedef reddedilir. Temizlik yalnızca testin oluşturduğu rastgele hesap/sohbet kimlikleri üzerinde yapılır. Uygulama veritabanında test temizliği, TRUNCATE veya veritabanı oluşturma yapılmaz.

Chrome/Edge görsel/etkileşimli kontrolleri ve üç fiziksel bilgisayarlı LAN testi **çalıştırılmadı; manuel test gerekli**. Otomasyon gerçek PostgreSQL/HTTP/Socket.IO kullanır; tarayıcı DOM etkileşim testi değildir. Grup adı/üyelik düzenleme, bildirim/okundu bilgisi, kalıcı taslak, dosya gönderimi, çok sunuculu dağıtım yoktur. Sunucu yeniden başlatılırsa yazıyor durumu sıfırlanır, mesajlar korunur.

## Aynı yerel ağdaki üç bilgisayarla manuel kabul testi

1. Sunucu bilgisayarda PostgreSQL'i başlatın, migration çalıştırın. PowerShell'de `$env:HOST='0.0.0.0'` ve ardından `npm.cmd start` çalıştırın. `ipconfig` ile sunucunun yerel IPv4 adresini bulun. Güvenlik duvarında TCP 3000 iznini yalnızca özel yerel ağla sınırlayın; yönlendiricide internet portu açmayın.
2. Üç bilgisayarda Chrome veya Edge ile `http://SUNUCU_IPV4:3000` açın. Üç farklı deneme hesabı A/B/C oluşturun; kişi listelerini yenileyin. Oturumsuz tarayıcıda kullanıcı/geçmiş API erişiminin reddedildiğini doğrulayın.
3. A, B'yi seçip mesaj göndersin; B aynı sohbeti A üzerinden açsın. İki yönde tekrar açınca tek özel sohbet ve aynı geçmiş görünmeli. A/B sohbeti C'nin listesinde görünmemeli.
4. A en az B ve C'yi seçip grup oluştursun. B/C sohbet listesini yenileyip gruba katılsın. Üç hesapla mesaj gönderin; doğru gönderen ve saat görünmeli. 50'den fazla mesajla önceki sayfayı yükleyin. Mesajın diğer bilgisayarda en geç iki saniyede göründüğünü ölçün; bu performans kabulü fiziksel ağda henüz ölçülmedi.
5. A yazarken yalnızca aynı sohbeti açık tutan üyelerde yazıyor göstergesi görünmeli; üç saniye durunca, gönderince, başka sohbet seçince ve A'nın bağlantısı kesilince silinmeli. B özel sohbet, C grup açıkken bildirimler karışmamalı.
6. Boş ve 1001 karakter mesajı deneyin. `<b>test</b>` düz metin görünmeli. Sayfayı yenileyin, geçmiş korunmalı ve yinelenmemeli. A'nın ağını kesip geri açın; bağlantı durumu ve geçmiş düzelmeli. Onay kaybolduysa aynı metni tekrar gönderin, ikinci kayıt oluşmamalı.
7. Başka sekmeden çıkış yapın; eski açık sekmeyle gönderim reddedilmeli. Üye olmayan ayrı deneme hesabıyla bilinen sohbet kimliğine erişim reddedilmeli. PostgreSQL ve HTTP sunucusunu durdurup hata/yeniden deneme durumlarını kontrol edin.
