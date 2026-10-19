# Web Tabanlı Anlık Mesajlaşma Uygulaması

Bu depo, Gereksinim-Analizi-Raporu.docx temelinde geliştirilmektedir. İlk aşamada hazırlanan bileşenler: Express sunucusu, masaüstü arayüz iskeleti ve geliştirme ortamı.

## Ön koşullar

- Node.js 22.9 veya üstü (24 LTS önerilir); npm Node.js ile gelir.
- Windows PowerShell ve güncel Chrome veya Edge.
- Bu aşamada PostgreSQL kurulumu gerekmez.

## Kurulum ve çalıştırma

Proje klasöründe PowerShell açın:

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run dev
```

`.env` mevcutsa kopyalama adımını atlayın; kendi ayarlarınızı koruyun. Tarayıcıda http://127.0.0.1:3000 adresini açın. Geliştirme komutu sunucu dosyası değişince yeniden başlar; HTML/CSS/JS değişince tarayıcıyı yenileyin. Durdurmak için Ctrl+C kullanın.

Dosya izleme olmadan başlatma:

```powershell
npm.cmd start
```

`HOST` varsayılanı `127.0.0.1`, `PORT` varsayılanı `3000` değeridir. Port doluysa `.env` içindeki PORT değerini değiştirin. Yapılandırma değişince sunucuyu yeniden başlatın. `.env` Git tarafından dışlanır; gerçek sırları `.env.example` içine yazmayın.

## Testler

```powershell
npm.cmd test
```

Node.js yerleşik test aracı geçici bir yerel HTTP portunda sunucuyu başlatır. Ana sayfa, CSS/JS, durum API'si, güvenlik başlığı, 404 yanıtı ve özel dosyaların sunulmaması kontrol edilir. Test sonrası sunucu kapatılır. Ayrı test bağımlılığı yoktur. Bu sade projede derleme veya lint komutu bulunmaz.

Manuel Chrome ve Edge kontrolü:

1. Sunucuyu başlatıp ana sayfayı açın. Hesap, kullanıcı listesi ve sohbet alanlarının okunabildiğini kontrol edin.
2. Giriş/kayıt, grup oluşturma ve mesaj gönderme kontrollerinin devre dışı olduğunu doğrulayın.
3. Sunucu durumunun yükleniyor durumundan erişilebilir durumuna geçtiğini görün.
4. Sunucuyu durdurun, açık sayfadaki Yeniden kontrol et düğmesine basın. Bağlantı yok ve hata alanı görünmelidir (en geç yaklaşık 5 saniyede).
5. Sunucuyu yeniden başlatıp Yeniden kontrol et düğmesine basın; hata alanı kapanmalıdır.

## Klasör yapısı

```text
public/
  index.html       Giriş/kayıt, kullanıcı listesi ve sohbet yer tutucuları
  styles.css       Masaüstü ağırlıklı, dar ekranlara uyarlanan görünüm
  app.js           Gerçek sunucu erişilebilirlik kontrolü ve hata durumu
server/
  app.js           Express uygulaması, statik dosyalar, sağlık kontrolü
  index.js         Ortam yapılandırması ve sunucunun başlatılması
test/
  server.test.js   Gerçek HTTP istekleriyle entegrasyon kontrolü
.env.example       Sır içermeyen örnek yapılandırma
```

`GET /api/health`, `{ "status": "ok", "stage": 1 }` döndürür. Bu yanıt yalnızca HTTP sunucusunun erişilebilirliğini gösterir; sohbet bağlantısı veya kullanıcı oturumu anlamına gelmez. Yalnızca `public/` klasörü statik olarak sunulur.

## Bağımlılık ve kapsam sınırları

Express, başlangıç HTTP sunucusunu ve statik dosya sunumunu sağlar; tek doğrudan bağımlılıktır. Ortam dosyası yükleme, geliştirme izleme ve testler Node.js'in yerleşik özelliklerini kullanır. package-lock.json tekrar üretilebilir kurulum için depoya eklenir.

Gerçek kayıt/giriş/çıkış, parola saklama, oturum, PostgreSQL, Socket.IO, özel/grup mesajlaşması, yazıyor göstergesi, mesaj geçmişi, E2EE ve yazım analizi **uygulanmadı**. Hiçbir form veri göndermez veya saklamaz. Kullanıcı listesi boş bir yer tutucudur. Arayüzdeki sunucu durumu kontrolü gerçek HTTP kontrolüdür; anlık sohbet bağlantısı değildir. Şifreleme veya güvenli mesajlaşma iddiası yoktur. Sonraki aşamalara geçilmemiştir.

## Yerel ağda yalnızca arayüz kontrolü

İlk tam kabul testi aynı ağda üç bilgisayarda yapılacaktır; bu aşamada hesap ve mesajlaşma kabul testi yapılamaz. Arayüzü başka bilgisayardan görmek için `.env` içinde `HOST=0.0.0.0` ayarlayıp sunucuyu yeniden başlatın. Sunucunun yerel IPv4 adresini `ipconfig` ile bulun ve diğer bilgisayarlarda `http://SUNUCU_YEREL_IP:3000` adresini açın. Gerekirse Windows Güvenlik Duvarında yalnızca özel ağ için ilgili porta izin verin. `0.0.0.0` tarayıcı hedef adresi değildir.

Bu HTTP geliştirme sunucusudur; internete açık üretim servisi olarak kullanılmamalıdır. HTTPS ve rapordaki güvenlik özellikleri sonraki aşamaların konusudur. Fiziksel üç bilgisayar, Chrome/Edge görsel kontrolleri ve etkileşimli ağ kesintisi senaryoları manuel doğrulama gerektirir; otomatik HTTP testleri bunların yapıldığı anlamına gelmez.
