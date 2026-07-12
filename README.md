# Chef istanbul  Kiosk Sistemi

Taşınabilir, Docker gerektirmeyen ve tek komutla çalışabilen restoran kiosk sistemi.

## Kurulum ve Çalıştırma

Bağımlılıkları yükleyin:

```bash
npm install
```

Sunucuyu başlatın:

```bash
npm start
```

Tarayıcıda açın:

* Admin / Kasa Paneli: `http://localhost:3000/admin`
* Kiosk (Örnek Masa): `http://localhost:3000/kiosk/teras-1-1781281075372`

---

## Varsayılan Admin Bilgileri

| Kullanıcı Adı | Şifre    |
| ------------- | -------- |
| admin         | admin123 |

İlk çalıştırmada varsayılan yönetici hesabı otomatik olarak oluşturulur.

---

## Özellikler

### Admin Paneli

* Gerçek zamanlı sipariş takibi ve sesli bildirim desteği
* Kategori yönetimi
* Menü ve ürün yönetimi
* Masa yönetimi ve kiosk bağlantıları oluşturma
* Satış, ciro ve kâr raporları
* PDF rapor oluşturma
* Kiosk arayüzü özelleştirme
* Site ve giriş sayfası tasarım ayarları

### Kiosk Ekranı

* Ürün ve kategori görüntüleme
* Anlık sipariş gönderme
* Sipariş takibi
* **Garson Çağır** özelliği
* QR kod, temassız kart ve nakit ödeme seçenekleri
* Temassız ödeme desteği

---

## Aynı Ağ Üzerinden Kullanım

Sunucunun IP adresini öğrenin (örnek: 192.168.1.100).

Kiosk cihazında:

```text
http://192.168.1.100:3000/kiosk/masa-1-...
```

Admin cihazında:

```text
http://192.168.1.100:3000/admin
```

---

## Veri Konumu

Tüm veriler aşağıdaki dosyada saklanır:

```text
data/kiosk.db
```

Başka bir bilgisayara taşırken bu dosyayı da kopyalamanız gerekir.

### Yüklenen Görseller

```text
public/img/
```

### Yüklenen Videolar

```text
public/videos/
```

Proje taşınırken bu klasörlerin de kopyalanması gerekir.

---

## Şifre Sıfırlama (E-posta ile)

### Gmail Uygulama Şifresi

Google Hesabı → Güvenlik → 2 Adımlı Doğrulama → Uygulama Şifreleri

### .env Ayarları

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=mailadresiniz@gmail.com
SMTP_PASS=16_haneli_sifre
SMTP_SECURE=false
```

Sunucuyu başlatın:

```bash
npm start
```

Şifre sıfırlama sayfası:

```text
http://localhost:3000/login
```

---

## Ödeme Sistemleri

`.env` dosyasından ödeme sağlayıcısı seçilebilir:

```env
PAYMENT_PROVIDER=simulation
```

Desteklenen ödeme sistemleri:

* Simulation
* Stripe
* İyzico
* PayTR

### Stripe

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### İyzico

```env
IYZICO_API_KEY=...
IYZICO_SECRET_KEY=...
IYZICO_BASE_URL=https://sandbox-api.iyzipay.com
```

### PayTR

```env
PAYTR_MERCHANT_ID=...
PAYTR_MERCHANT_KEY=...
PAYTR_MERCHANT_SALT=...
PAYTR_BASE_URL=https://www.paytr.com
```

---

## Başlatma

Proje klasöründe bulunan **BASLAT.bat** dosyasına çift tıklayarak sistemi başlatabilirsiniz.

Bu dosya:

* Sunucuyu otomatik olarak başlatır.
* Gerekli servisleri çalıştırır.
* Admin panelini varsayılan tarayıcıda açar.

Alternatif olarak terminal üzerinden:

```bash
npm start
```

komutu ile de proje başlatılabilir.

---

## Kullanılan Teknolojiler

* Node.js
* Express.js
* SQLite (sql.js)
* Socket.io
* express-session
* bcrypt
* multer
* html2canvas
* jsPDF
* qrcodejs

---

## Temel Özellikler

* Gerçek zamanlı sipariş yönetimi
* Kategori ve ürün yönetimi
* Masa bazlı kiosk sistemi
* Garson Çağır modülü
* Sipariş takip sistemi
* QR kod, temassız kart ve nakit ödeme seçenekleri
* Satış, ciro ve kâr analizi
* PDF rapor oluşturma
* Görsel ve video özelleştirme
* E-posta ile şifre sıfırlama
* Stripe, İyzico ve PayTR ödeme entegrasyonları

---

## Lisans

MIT

---

## Geliştirici

**Developed by Parwiz Abdulhameed**
