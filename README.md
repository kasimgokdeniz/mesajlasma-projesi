# Web Tabanlı Anlık Mesajlaşma Uygulaması

Mevcut üç sütunlu arayüz korunarak kayıt, giriş, çıkış, oturum kontrolü ve kullanıcı listesi PostgreSQL API'lerine bağlandı.

## Kurulum ve başlatma

Node.js 22.9+, npm, PostgreSQL ve Chrome/Edge gerekir. PowerShell yürütme politikasını değiştirmeyin.

```powershell
npm.cmd ci
# Yalnızca .env yoksa:
Copy-Item .env.example .env
```

Mevcut `.env` üzerine kopyalamayın. Yerel dosyada PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, TEST_PGDATABASE ve en az 32 karakterlik güvenli rastgele SESSION_SECRET bulunmalıdır. Bu çalışmada eksik oturum sırrı güvenli rastgele üretilip değeri gösterilmeden yerel dosyaya eklendi. Sırları Git'e eklemeyin.

Veritabanları `mesajlasma` ve `mesajlasma_test`, kullanıcı `mesajlasma_app` olarak zaten hazırdır. Migration veritabanı oluşturmaz, süper kullanıcı yetkisi istemez. Başka kurulumda PostgreSQL yöneticisi iki veritabanını oluşturmalı; uygulama kullanıcısına CONNECT, hedef şemada USAGE/CREATE yetkileri vermelidir.

```powershell
npm.cmd run migrate
npm.cmd run migrate:test
npm.cmd test
npm.cmd run dev
```

http://127.0.0.1:3000 adresini açın. İzlemesiz başlatma: `npm.cmd start`. Durdurma: Ctrl+C. HOST varsayılanı 127.0.0.1, PORT varsayılanı 3000. Ortam ayarları değişince yeniden başlatın.

PostgreSQL kapalıyken de geçerli ortam değişkenleri ve oturum sırrıyla HTTP sunucusu ve arayüz açılır. Hesap API'leri genel hata verir; bellek içi sahte hesaba geçilmez. PostgreSQL'i başlatın, migration çalıştırın ve yeniden deneyin. Sağlık API'si yalnızca HTTP erişimini gösterir.

## API ve güvenlik

| Uç nokta | İşlev |
| --- | --- |
| GET /api/health | HTTP durumu; stage: 2, veritabanını kontrol etmez |
| POST /api/auth/register | JSON username/password; kayıt ve oturum |
| POST /api/auth/login | JSON username/password; doğrulama ve yeni oturum kimliği |
| POST /api/auth/logout | JSON {}; oturumu siler, çerezi temizler |
| GET /api/auth/me | Oturum sahibinin id/username alanları |
| GET /api/users | Oturum gerekli; diğer hesapların yalnızca id/username alanları |

Kullanıcı adı 3–32 ASCII harf/rakam/alt çizgi; küçük harfe dönüştürülerek benzersiz tutulur. Parola 12–128 karakterdir. Rastgele tuzlu scrypt (N=32768, r=8, p=3) kullanılır. SQL girdileri parametrelidir. İstemci kullanıcı adlarını textContent ile gösterir. JSON gövdesi 8 KB ile sınırlı; çapraz kaynaklı yazma istekleri reddedilir. Hatalarda bağlantı bilgisi veya sır gösterilmez.

Oturumlar PostgreSQL sessions tablosunda kalıcıdır. Çerez HttpOnly, SameSite=Lax ve 8 saat ömürlüdür. Kayıt/giriş kimliği yeniler, çıkış eski oturumu iptal eder. Yerelde NODE_ENV=development HTTP içindir. Üretimde NODE_ENV=production Secure çerezi etkinleştirir: HTTPS sonlandıran tek güvenilir ters vekil arkasında çalıştırın (trust proxy=1); uygulama portuna doğrudan dış erişimi kapatın. SESSION_SECRET değişikliği mevcut oturumları geçersiz kılar. Giriş deneme sınırlaması ve kapsamlı güvenlik denetimi henüz yoktur; bu sürüm internete açık üretim dağıtımı değildir.

## Şema ve dosyalar

migrations/001_accounts.sql işlem içinde sürüm kaydı ve kilitle bir kez uygulanır; tekrar çalıştırılabilir. Mevcut veritabanlarını silmez. users, sessions ve schema_migrations kullanılır. Raporun conversations, conversation_members, messages, user_public_keys, key_envelopes, writing_profiles tabloları ilişkiler/indekslerle hazırdır; bu aşamada bunlara kullanıcı API'si sunulmaz. Şifreli paket biçimleri sonraki aşamalarda kesinleşecektir; şema E2EE uygulandığı anlamına gelmez.

- public/: korunmuş HTML/CSS ve hesap API istemcisi.
- server/app.js, index.js: HTTP ve oturum yapılandırması.
- server/db.js, migrate.js: bağlantı ve migration.
- server/accounts.js, passwords.js, access.js: hesaplar, parola özeti ve ortak erişim/sohbet üyeliği yardımcısı.
- test/: gerçek HTTP ve PostgreSQL kontrolleri.

Express HTTP sunumu sağlar. pg PostgreSQL bağlantısı; express-session oturum/çerez yaşam döngüsü; connect-pg-simple PostgreSQL oturum deposu için gereklidir. Kriptografi, ortam yükleme ve test aracı Node.js içinde yerleşiktir. .env Git tarafından dışlanır; gerçek sırları, özel anahtarları veya dump dosyalarını eklemeyin.

## Testler ve sınırlar

`npm.cmd test` yalnızca TEST_PGDATABASE üzerinden gerçek PostgreSQL'e bağlanır. Değer eksikse veya PGDATABASE ile aynıysa başarısız olur; uygulama veritabanına düşmez. Bu hedef yalnızca test için ayrılmalıdır. Testler rastgele hesaplar oluşturur, yalnızca kendi kayıtlarını kimlikleriyle temizler; TRUNCATE/veritabanı oluşturma yoktur.

Migration tekrarı, tablolar, kayıt/benzersizlik, parola özeti, yanlış/doğru giriş, çıkış iptali, çerez bayrakları, oturumsuz erişim, güvenli liste alanları, hatalı girdi/JSON, çapraz kaynak ve üyelik yardımcısı test edilir. Ana sayfa, varlıklar ve özel dosyaların sunulmaması da denetlenir. Build/lint komutu yoktur.

Gerçek çalıştırmada her iki migration başarılı; 7 test geçti, 0 başarısız. body-parser güvenlik güncellemesi sonrası npm denetimi 0 açık bildirdi. Chrome/Edge görsel/etkileşimli ve üç fiziksel bilgisayar kontrolleri çalıştırılmadı; manuel test gerekir:

1. Kayıt olun; aynı adla tekrar kayıt reddedilmeli.
2. Çıkış yapıp yanlış, sonra doğru parolayla giriş yapın. Sayfa yenilenince oturum korunmalı.
3. Başka tarayıcıda ikinci hesap oluşturup listeyi yenileyin. Oturumsuzken liste görünmemeli.
4. PostgreSQL/HTTP sunucusunu durdurup hata ve yeniden deneme durumlarını kontrol edin.

LAN için HOST=0.0.0.0 ayarlayın; ipconfig ile bulunan sunucu IPv4 adresini diğer bilgisayarlarda açın. Güvenlik duvarı iznini özel ağla sınırlayın. Yerel HTTP parolaları ağda şifrelemez; yalnızca güvenilen test ağında deneme hesapları kullanın. Üretimde HTTPS gerekir.

Socket.IO, özel/grup sohbet işlemleri, yazıyor göstergesi, geçmiş, E2EE ve yazar analizi uygulanmadı. Sohbet ve grup kontrolleri devre dışıdır. Sonraki aşamalara geçilmedi.
