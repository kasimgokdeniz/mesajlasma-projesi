# Teslim ve kabul testleri

## Yazım tarzı yöntemi

Tarayıcı, NFC ile normalleştirilmiş metindeki Unicode harf dizilerini kelime olarak sayar. Her küme en az 40 kelime ve 2–8 mesaj içermelidir. Birkaç kısa mesajda tek bir işaret veya selamlama oranları belirgin biçimde değiştirebildiği için iki mesaj ve 40 kelime alt sınırı kullanılır. Bu sınır bir pilot uygulama tercihidir. Üst sınır seçimi ve şifreli aktarım boyutunu sınırlı tutar. Örneklerin UTF-8 JSON boyutu en fazla 12.000 bayttır.

| Özellik | Karşılaştırma | Ağırlık |
| --- | --- | --- |
| Noktalama | Nokta, virgül, ünlem, soru işareti, iki nokta, noktalı virgül ve üç nokta karakterinin kelime başına oranları. Oran farklarının toplamı ikiyle çarpılır ve 1 ile sınırlanır. | %25 |
| Büyük harf | Büyük harflerin tüm harflere oranının mutlak farkı dörtle çarpılır ve 1 ile sınırlanır. | %20 |
| Kelime uzunluğu | 1–7 ve 8+ harf gruplarındaki oranların toplam değişim uzaklığı. | %25 |
| Karakter üçlüleri | Türkçe küçük harfe çevrilen kelimeler içindeki üçlülerin 128 gruba dağılımının toplam değişim uzaklığı. | %30 |

Noktalama ve harf kullanımı yazım alışkanlıklarını, uzunluk dağılımı kelime seçimini, üçlüler yerel yazım örüntülerini yakalar. Üçlülerin konuya duyarlılığı yüzünden toplam ağırlıkları %30 ile sınırlıdır. Uzaklıkların ağırlıklı toplamı 0 ile 1 arasındadır. 0,35 altında **Uyum**, 0,35 ve üzerinde **Farklılık** gösterilir. Bu başlangıç eşiğinde tek bir özellik grubunun en yüksek katkısı bile tek başına farklılık uyarısına yetmez. Ağırlıklar ve eşik bir kullanıcı nüfusu üzerinde kalibre edilmemiştir.

Profilin örnek mesaj kimlikleri ve metinleri birlikte şifrelenir. Seçim tek bir gönderene aittir ve değerlendirmeye giren her mesajın kimliği en yeni örnek kimliğinden büyük olmalıdır. Bu kural, aynı mesajın hem örnek hem değerlendirme metni olarak kullanılmasını önler. Kopyalanmış metin, konu değişimi, çok dilli yazım ve biçim değişikliği sonucu etkileyebilir. Örneklerin kime ait olduğunu profil sahibi kendi seçimiyle beyan eder.

### Ayrı değerlendirme metinleri

`test/writing-style.test.js` iki kurmaca örnek mesajı ve her satır için iki ayrı kurmaca değerlendirme mesajı kullanır. `node --test test/writing-style.test.js` çalıştırmasındaki sonuçlar aşağıdadır.

| Senaryo | Uzaklık | Sonuç | Yorum |
| --- | --- | --- | --- |
| Aynı kurmaca yazar, gündelik plan | 0,136 | Uyum | Beklenen sonuç |
| Farklı kurmaca yazar, yoğun büyük harf ve noktalama | 0,827 | Farklılık | Beklenen sonuç |
| Aynı kurmaca yazar, duyuru biçimi | 0,624 | Farklılık | Yanlış uyarı. Üslup ve biçim değişikliği uzaklığı artırdı. |
| Farklı kurmaca yazar, benzer bağlam ve dil | 0,118 | Uyum | Kaçırılan farklılık. Benzer kelimeler ve noktalama ayrımı zorlaştırdı. |
| İki çok kısa mesaj veya tek uzun mesaj | — | Yetersiz metin | Alt sınır doğrulandı. |

Bu örnekler yöntemin davranışını ve hata biçimlerini gösteren küçük senaryolardır. Nüfus düzeyinde doğruluk veya kimlik kanıtı çıkarımı yapılamaz.

## Gereksinim, kabul ölçütü ve test

`npm.cmd run migrate:test` ve `npm.cmd test` ayrı PostgreSQL test veritabanında tamamlandı. Test koşumunda 19 test geçti, atlanan test olmadı. Tarayıcı testi başsız Chrome ile geçici profillerde çalıştı. Edge ve üç fiziksel bilgisayar kabulde ayrıca doğrulanmalıdır.

| Gereksinim | Kabul ölçütü | Test ve durum |
| --- | --- | --- |
| Kayıt | Hesap açılır, kullanıcı adı benzersiz, parola güvenli özetle saklanır. | Geçti · `accounts.test.js` |
| Giriş ve çıkış | Yanlış parola reddedilir, giriş oturumu yeniler, çıkış HTTP ve açık socket yetkisini iptal eder. | Geçti · `accounts.test.js`, `chat.test.js` |
| Kullanıcı listesi | Giriş yapan hesap diğer kullanıcıları görür. | Geçti · `accounts.test.js` |
| Özel sohbet | İki yönlü oluşturma aynı sohbeti verir, yalnızca iki üye mesaj alır. | Geçti · `chat.test.js`, `browser.test.js` |
| Grup sohbeti | Kurucu ve seçilen üyeler mesaj alır, dış hesap erişemez. | Geçti · `chat.test.js`, `browser.test.js` |
| Yazıyor | Yalnızca ilgili üyeler görür. Yaklaşık üç saniye, gönderim veya kopmayla temizlenir. | Geçti · `chat.test.js` |
| Şifreli geçmiş | PostgreSQL'e şifreli içerik yazılır. Sayfalama ve yeniden bağlantıda kayıt tekrarlanmaz. | Geçti · `chat.test.js`, `browser.test.js` |
| Erişim ve paket denetimi | Oturum, üyelik, profil sahipliği, bozuk paket, yanlış zarf ve SQL girdisi denetlenir. | Geçti · `accounts.test.js`, `chat.test.js` |
| Tarayıcıda güvenli gösterim | HTML görünümlü metin DOM öğesine dönüşmez. Anahtar kaybı, paket bozulması ve anahtar değişikliği görünür hata verir. | Geçti · `browser.test.js`, `chat.test.js` |
| Yazar analizi | Sahip profili kaydeder ve değiştirir. Üye şifreli paketi açar. Örnekler yerine sonraki mesajlar değerlendirilir. | Geçti · `chat.test.js`, `browser.test.js`, `writing-style.test.js` |

## Üç fiziksel bilgisayar

**Durum: manuel test gerekli.** Aynı yerel ağa bağlı A/B/C cihazları, üç deneme hesabı ve her tarayıcının güvendiği aynı yerel HTTPS adresi gerekir. Gerçek kullanıcı anahtarları ve kayıtları yerine deneme hesaplarını kullanın.

1. A/B/C cihazlarında kayıt ve giriş yapın. Her cihazda diğer hesapları kullanıcı listesinde görün. Parmak izlerini karşılaştırıp sohbet üyelerinin anahtarlarını onaylayın.
2. A ve B iki yönde özel sohbet açsın ve birer mesaj göndersin. Tek sohbet kaydını ve iki yönlü teslimi doğrulayın. C hesabıyla özel sohbetin geçmiş, anahtar ve profil uç noktalarının 403 döndürdüğünü denetleyin.
3. A, B ve C ile grup oluştursun. Her cihazdan diğer ikisine mesaj gönderin. Gönderim ve ekranda görünme arasındaki süreyi ölçün ve cihazlar arası iki saniyelik hedefi kaydedin. Yazıyor bilgisinin yalnızca ilgili sohbette göründüğünü ve bekleme, gönderim ve kopmada temizlendiğini gözlemleyin.
4. A iki veya daha fazla bilinen mesaj seçip profili kaydetsin. A daha sonra ayrı değerlendirme mesajları göndersin. B önce kısa örnekle yetersiz metni, sonra yeterli metinle uyum veya farklılık sonucunu görün. A profili açıkça güncellesin. B'nin A adına yazma isteği 403 dönmeli.
5. B'yi yenileyin ve ağ bağlantısını kesip geri açın. Geçmiş ve profil okunabilmeli, yinelenen mesaj olmamalı. 50'den fazla mesajda eski sayfayı yükleyin. HTML görünümlü deneme metni düz metin olarak görünmeli.
6. Yalnızca C'nin deneme tarayıcı profilindeki anahtar kaydını kaldırın. Eski paketlerin açılma hatasını, yenileme sonrası parmak izi doğrulamasını ve yeni mesajların açılmasını kontrol edin. C'nin çıkışından sonra API ve açık socket işlemlerinin reddedildiğini doğrulayın.
7. Ağ ve test veritabanı kayıtlarında deneme mesajlarını, açık örnekleri ve özel anahtar alanlarını arayın. Her adım için cihaz, tarayıcı, süre ve sonucu kaydedin.
