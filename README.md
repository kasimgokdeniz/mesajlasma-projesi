# Web Tabanlı Anlık Mesajlaşma Uygulaması

Tarayıcıda uçtan uca şifreli özel ve grup sohbetleri, yazıyor göstergesi, PostgreSQL geçmişi ve seçilen mesajlar için yazım tarzı analizi.

## Kurulum ve çalıştırma

Node.js 22.9+, PostgreSQL ve masaüstü Chrome veya Edge gerekir. PostgreSQL'de uygulama ve test için iki ayrı veritabanı önceden oluşturun. Bağlantı kullanıcısına ilgili veritabanında CONNECT ve hedef şemada USAGE/CREATE yetkisi verin. Yeni kurulumda `.env.example` dosyasını `.env` olarak kopyalayın ve `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `TEST_PGDATABASE` ve en az 32 karakterli rastgele bir `SESSION_SECRET` ayarlayın.

```powershell
npm.cmd ci
npm.cmd run migrate
npm.cmd start
```

Varsayılan adres `http://127.0.0.1:3000`. Geliştirmede otomatik yeniden başlatma için `npm.cmd run dev` kullanın. Migration şemayı hazırlar ve mevcut kayıtları korur. Yazım profili ilk migration'da oluşturulan `writing_profiles` tablosunu kullanır. `/api/health` HTTP erişimini gösterir.

```powershell
npm.cmd run migrate:test
npm.cmd test
```

Test bağlantısı için `TEST_PGDATABASE` zorunludur ve `PGDATABASE` değerinden farklı olmalıdır. Temizlik testin oluşturduğu hesap ve sohbet kimlikleriyle sınırlıdır. Tarayıcı testi geçici profiller kullanır. Chrome/Edge otomatik bulunamazsa `CHROME_PATH` ayarlayın. Projede ayrı lint veya build komutu yoktur.

## Mesajlaşma ve yazar analizi

1. Her üye bir kez kendi tarayıcısında giriş yaparak açık anahtarını yayımlar. Kullanıcı listesinden özel sohbet başlatın veya en az iki başka üye seçerek grup kurun. Grup en fazla 100 üye alır.
2. **Kendi parmak izim** değerlerini güvenilir bir kanaldan karşılaştırın. Eşleşen değerleri **Üye anahtarlarını doğrula** ile onaylayın. İlk veya değişmiş bir üye anahtarı yeniden doğrulanana kadar gönderim ve profil kaydı bekler.
3. **Yazar analizi → Kendi bilinen örneklerimi seç** bölümünde kendi şifresi açılmış 2–8 mesajınızı seçin. Toplam en az 40 kelime gerekir. **Profili oluştur veya güncelle** seçimi o sohbetteki örnek kümesinin tamamı olarak kaydeder. Gerekirse **Önceki mesajlar** ile eski örnekleri yükleyin.
4. **Sonraki mesajları analiz et** bölümünde tek bir gönderenin örnek kümesindeki son mesajdan daha sonra gönderdiği 2–8 mesajı seçin. Sonuç **Uyum**, **Farklılık** veya **Yetersiz metin** olabilir. Örnek yoksa veya gerekli yerel anahtar eksikse durum ekranda gösterilir.

Analiz tarayıcıda çalışır. Seçilen değerlendirme mesajları profile otomatik eklenmez. Sonuç yazım benzerliğini gösterir ve kesin kimlik kanıtı değildir. Mesajlaşma ve oturum analiz sonucundan bağımsızdır. Yöntem, deneme sonuçları ve kabul tablosu [Teslim ve kabul testleri](TESLIM.md) belgesindedir.

## Şifreleme ve anahtar kaybı

Mesajlar ve profil örnekleri ayrı AES-256-GCM anahtarlarıyla şifrelenir. Her anahtar, gönderen veya profil sahibi dahil sohbet üyelerinin doğrulanmış RSA-OAEP-2048/SHA-256 açık anahtarlarına ayrı ayrı zarflanır. Paketler ilgili sohbete ve hesaba bağlıdır. Profil ve mesaj paketleri farklı doğrulama bağlamları kullanır. Profil örneklerinin metni ve mesaj kimlikleri şifreli paketin içindedir. Sunucu oturumu, üyeliği, paket yapısını ve alıcı anahtar sürümlerini denetler. Profil okuma sohbet üyelerine, kayıt profil sahibine açıktır.

Özel anahtarlar IndexedDB'de hesap bazında dışa aktarılamayan CryptoKey olarak saklanır. Çıkış anahtarları silmez. Tarayıcı verisinin silinmesi, farklı cihaz veya tarayıcı profili ve adres/köken değişikliği anahtarı erişilemez kılabilir. Parola anahtarı geri getirmez. **Anahtarı yenile** açık onay alır. Diğer üyeler yeni parmak izini doğrulamalıdır. Kayıp anahtarla şifrelenmiş geçmiş ve profil sürümü açılamaz. Profil sahibi erişebildiği örneklerle profili açıkça yeniden kaydedebilir. Cihazlar arası aktarım ve yedekleme desteği yoktur.

Mesaj başına 1–1000 JavaScript karakter birimi desteklenir. Geçmiş 50'şer kayıt yüklenir. Kesintiden sonra geçmiş mesaj kimliğiyle birleştirilir. Eski açık metin kayıtları etiketlenir ve analiz örneği olarak seçilemez. Grup adı, üyelik, gönderen, zaman ve yazıyor metaverisi sunucu tarafından görülebilir. İleri gizlilik, bağımsız gönderen imzası ve anahtar şeffaflığı yoktur. Güvenlik, sunulan istemci koduna ve üyelerin parmak izi doğrulamasına bağlıdır.

Web Crypto, IndexedDB ve tarayıcı kilitleri için güvenli bağlam gerekir. Loopback geliştirmede HTTP kullanılabilir. Üç cihazlı kabul testi, her cihazın güvendiği aynı yerel HTTPS kökenini gerektirir. Üretim modu güvenilen bir HTTPS ters vekili ve Secure oturum çerezi kullanır. Node dinleyicisini vekilin arkasında tutun.
