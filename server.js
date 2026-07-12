// ============================================================
// Chef İstanbul — server.js (JWT TAMAMEN KALDIRILDI, SESSION TABANLI)
// + ÖDEME SİSTEMİ (Simülasyon / İyzico / Stripe / PayTR)
// + POPÜLER MENÜ KALICI (salesCount) + delivered anında güncelleme
// + EK MENÜ (Öne Çıkanlar / Kampanya Ürünleri)
// + GARSON ÇAĞIR SİSTEMİ (kalıcı, ödeme ile otomatik silinir)
// + VİDEO YÜKLEME DESTEĞİ (ortam videosu ve ekran koruyucu)
// + KALICI DOSYA SİLME (resim ve videolar için)
// + GÜVENLİK: Admin sayfalarına sadece oturum açmış kullanıcılar erişebilir
// + ADMIN LOGO & TITLE DESTEĞİ (Site Ayarları)
// + TOPLU SİLME (bulk-delete) endpointleri eklendi
// ============================================================
require('dotenv').config();
const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const multer       = require('multer');
const path         = require('path');
const fs           = require('fs');
const { v4: uuid } = require('uuid');
const initSqlJs    = require('sql.js');
const bcrypt       = require('bcrypt');
const rateLimit    = require('express-rate-limit');
const nodemailer   = require('nodemailer');
const session      = require('express-session');
const crypto       = require('crypto');
const axios        = require('axios');

// ── Klasörler ──────────────────────────────────────────────
const PORT     = process.env.PORT || 3000;
const ROOT     = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const IMG_DIR  = path.join(ROOT, 'public', 'img');
const SND_DIR  = path.join(ROOT, 'public', 'sounds');
const VIDEO_DIR = path.join(ROOT, 'public', 'videos');
[DATA_DIR, IMG_DIR, SND_DIR, VIDEO_DIR].forEach(d => !fs.existsSync(d) && fs.mkdirSync(d, { recursive:true }));

// ── Express + Socket.io ────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors:{ origin:'*' }, pingTimeout:60000 });

app.use(express.json());
app.use(express.urlencoded({ extended:true }));
app.use(express.static(path.join(ROOT, 'public')));

// ── Session yapılandırması ────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'chef-istanbul-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }
}));

// ── Multer (temel storage) ─────────────────────────────────
function makeStorage(dest) {
  return multer.diskStorage({
    destination: (_, __, cb) => cb(null, dest),
    filename:    (_, f, cb)  => cb(null, uuid() + path.extname(f.originalname))
  });
}
// Resim yükleme
const imgUpload = multer({ storage: makeStorage(IMG_DIR), limits:{ fileSize:8*1024*1024 },
  fileFilter:(_, f, cb) => f.mimetype.startsWith('image/') ? cb(null,true) : cb(new Error('Görsel bekleniyor')) });
// Ses yükleme
const sndUpload = multer({ storage: makeStorage(SND_DIR), limits:{ fileSize:4*1024*1024 },
  fileFilter:(_, f, cb) => (f.mimetype.startsWith('audio/') || f.originalname.match(/\.(mp3|wav|ogg)$/i)) ? cb(null,true) : cb(new Error('Ses dosyası bekleniyor')) });

// Özel: Ayarlar için resim + video yükleme (tek multer) - LİMİT 150MB
const settingsStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'restaurant_logo' || file.fieldname === 'kiosk_bg_image' || file.fieldname === 'admin_logo') {
      cb(null, IMG_DIR);
    } else if (file.fieldname === 'kiosk_ambient_video' || file.fieldname === 'kiosk_screensaver_video') {
      cb(null, VIDEO_DIR);
    } else {
      cb(new Error('Geçersiz alan'));
    }
  },
  filename: (req, file, cb) => {
    cb(null, uuid() + path.extname(file.originalname));
  }
});
const settingsUpload = multer({
  storage: settingsStorage,
  limits: { fileSize: 150 * 1024 * 1024 }, // 150 MB limit
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'restaurant_logo' || file.fieldname === 'kiosk_bg_image' || file.fieldname === 'admin_logo') {
      if (file.mimetype.startsWith('image/')) return cb(null, true);
      else return cb(new Error('Resim dosyası bekleniyor'));
    } else if (file.fieldname === 'kiosk_ambient_video' || file.fieldname === 'kiosk_screensaver_video') {
      const allowed = ['video/mp4', 'video/webm'];
      if (allowed.includes(file.mimetype)) return cb(null, true);
      else return cb(new Error('Sadece .mp4 veya .webm'));
    } else {
      cb(new Error('Geçersiz alan'));
    }
  }
});

// ── DB yardımcıları ────────────────────────────────────────
let db;
const DB_FILE = path.join(DATA_DIR, 'kiosk.db');

function saveDb() {
  try { fs.writeFileSync(DB_FILE, Buffer.from(db.export())); } catch(e) { console.error('DB kayıt:', e.message); }
}
const run  = (sql, p=[]) => { db.run(sql, p); saveDb(); };
const get  = (sql, p=[]) => { const s=db.prepare(sql); s.bind(p); const r=s.step()?s.getAsObject():undefined; s.free(); return r; };
const all  = (sql, p=[]) => { const s=db.prepare(sql); s.bind(p); const r=[]; while(s.step()) r.push(s.getAsObject()); s.free(); return r; };
const lastId = () => get('SELECT last_insert_rowid() as id').id;
function getSettings() { return Object.fromEntries(all('SELECT key,value FROM settings').map(r=>[r.key,r.value])); }
function setSetting(k,v) { db.run('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)',[k,v]); saveDb(); }
function getSetting(key) { return get('SELECT value FROM settings WHERE key = ?', [key])?.value || ''; }

// ── Slug oluşturucu ────────────────────────────────────────
function createSlugFromName(name) {
  const normalized = name.toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  return `${normalized}-${Date.now()}`;
}

// ── Rate Limiting (sadece login için) ──
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Çok fazla başarısız giriş denemesi. Lütfen 15 dakika sonra tekrar deneyin.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Şifre sıfırlama token deposu ──
const resetTokens = new Map();

// ── E-posta gönderimi için transporter ──
let transporter = null;
async function initEmailTransporter() {
  try {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log('📧 Test e-posta hesabı oluşturuldu:', testAccount.web);
  } catch (err) {
    console.warn('E-posta transporter başlatılamadı:', err.message);
  }
}

// ============================================================
// ÖDEME SAĞLAYICI YÜKLEME (Simülasyon / İyzico / Stripe / PayTR)
// ============================================================
const providerName = (process.env.PAYMENT_PROVIDER || 'simulation').toLowerCase();
let paymentProvider = null;

if (providerName === 'simulation') {
  paymentProvider = {
    createPaymentLink: async (tableId, amount, tipAmount, baseAmount, transactionId, req) => {
      const paymentLink = `https://payment.simulator.com/pay/${transactionId}`;
      console.log(`🔁 Simülasyon ödeme linki oluşturuldu: ${paymentLink}`);
      return paymentLink;
    },
    handleWebhook: async (req, res) => {
      const { transactionId } = req.body;
      if (transactionId) return { success: true, transactionId };
      return { success: false };
    }
  };
  console.log('✅ Simülasyon ödeme sağlayıcı yüklendi');
} else if (providerName === 'iyzico') {
  const Iyzipay = require('iyzipay');
  const iyzipay = new Iyzipay({
    apiKey: process.env.IYZICO_API_KEY,
    secretKey: process.env.IYZICO_SECRET_KEY,
    uri: process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com'
  });
  paymentProvider = {
    createPaymentLink: async (tableId, amount, tipAmount, baseAmount, transactionId, req) => {
      return new Promise((resolve, reject) => {
        const request = {
          locale: 'tr',
          conversationId: transactionId,
          price: amount.toFixed(2),
          paidPrice: amount.toFixed(2),
          currency: 'TRY',
          basketId: transactionId,
          paymentGroup: 'PRODUCT',
          callbackUrl: `${req.protocol}://${req.get('host')}/api/payment/iyzico-callback`,
          basketItems: [{
            id: transactionId,
            name: `Masa ${tableId} Siparişi`,
            category1: 'Restaurant',
            itemType: 'PHYSICAL',
            price: amount.toFixed(2)
          }]
        };
        iyzipay.checkoutFormInitialize.create(request, (err, result) => {
          if (err) reject(err);
          else resolve(result.paymentPageUrl);
        });
      });
    },
    handleWebhook: async (req, res) => {
      const { conversationId } = req.query;
      return { success: true, transactionId: conversationId };
    }
  };
  console.log('✅ İyzico ödeme sağlayıcı yüklendi');
} else if (providerName === 'stripe') {
  const Stripe = require('stripe');
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  paymentProvider = {
    createPaymentLink: async (tableId, amount, tipAmount, baseAmount, transactionId, req) => {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'try',
            product_data: { name: `Masa ${tableId} Siparişi` },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${req.protocol}://${req.get('host')}/payment-success?session_id={CHECKOUT_SESSION_ID}&tid=${transactionId}`,
        cancel_url: `${req.protocol}://${req.get('host')}/payment-cancel`,
        metadata: { tableId, transactionId, tipAmount, baseAmount }
      });
      return session.url;
    },
    handleWebhook: async (req, res) => {
      const sig = req.headers['stripe-signature'];
      const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const transactionId = session.metadata.transactionId;
        return { success: true, transactionId };
      }
      return { success: false };
    }
  };
  console.log('✅ Stripe ödeme sağlayıcı yüklendi');
} else if (providerName === 'paytr') {
  paymentProvider = {
    createPaymentLink: async (tableId, amount, tipAmount, baseAmount, transactionId, req) => {
      const merchantId = process.env.PAYTR_MERCHANT_ID;
      const merchantKey = process.env.PAYTR_MERCHANT_KEY;
      const merchantSalt = process.env.PAYTR_MERCHANT_SALT;
      const baseUrl = process.env.PAYTR_BASE_URL || 'https://www.paytr.com';
      const hash_str = `${merchantId}${transactionId}${amount}${req.body?.successUrl || ''}${req.body?.failUrl || ''}${req.body?.callbackUrl || ''}${merchantSalt}`;
      const paytr_token = crypto.createHash('md5').update(hash_str).digest('hex');
      const response = await axios.post(`${baseUrl}/odeme`, {
        merchant_id: merchantId,
        user_ip: req.ip,
        merchant_oid: transactionId,
        email: 'test@test.com',
        payment_amount: amount,
        currency: 'TRY',
        test_mode: 1,
        non_3d: 0,
        merchant_ok_url: `${req.protocol}://${req.get('host')}/api/payment/paytr-callback?status=success&tid=${transactionId}`,
        merchant_fail_url: `${req.protocol}://${req.get('host')}/api/payment/paytr-callback?status=fail&tid=${transactionId}`,
        user_basket: `[[\"Masa ${tableId} Siparişi\",${amount},1]]`,
        debug_on: 1,
        merchant_key: merchantKey,
        paytr_token: paytr_token
      });
      return response.data;
    },
    handleWebhook: async (req, res) => {
      const { status, tid } = req.query;
      if (status === 'success') return { success: true, transactionId: tid };
      return { success: false };
    }
  };
  console.log('✅ PayTR ödeme sağlayıcı yüklendi');
} else {
  console.error(`❌ Geçersiz PAYMENT_PROVIDER: ${providerName}. Lütfen .env dosyasında simulation, iyzico, stripe veya paytr kullanın.`);
  process.exit(1);
}

// ============================================================
// YARDIMCI FONKSİYONLAR (salesCount güncelleme)
// ============================================================
async function updateSalesCountForOrder(orderId) {
  const items = all('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
  for (const item of items) {
    if (item.product_id) {
      db.run('UPDATE products SET salesCount = salesCount + ? WHERE id = ?', [item.quantity, item.product_id]);
    }
  }
  saveDb();
}

// ============================================================
// EK MENÜ (ÖNE ÇIKANLAR)
// ============================================================
app.get('/api/featured', (req, res) => {
  const onlyActive = req.query.active === '1' ? 1 : undefined;
  let sql = 'SELECT * FROM featured_items ORDER BY sort_order, id';
  let params = [];
  if (onlyActive !== undefined) {
    sql = 'SELECT * FROM featured_items WHERE active = ? ORDER BY sort_order, id';
    params = [onlyActive];
  }
  const items = all(sql, params);
  res.json(items);
});

app.post('/api/featured', imgUpload.single('image'), (req, res) => {
  const { name, price, description, active, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Ürün adı gerekli' });
  const image = req.file ? `/img/${req.file.filename}` : '';
  db.run(
    `INSERT INTO featured_items (name, price, description, image, active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, price || 0, description || '', image, active === '1' ? 1 : 0, sort_order || 0]
  );
  const id = lastId();
  saveDb();
  io.emit('featured:updated');
  res.json({ id, name, price: price || 0, image });
});

app.put('/api/featured/:id', imgUpload.single('image'), (req, res) => {
  const item = get('SELECT * FROM featured_items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Bulunamadı' });
  const { name, price, description, active, sort_order, remove_image } = req.body;
  let image = item.image;
  if (remove_image === '1') {
    if (image && image.startsWith('/img/')) {
      try { fs.unlinkSync(path.join(ROOT, 'public', image)); } catch(e) {}
    }
    image = '';
  } else if (req.file) {
    image = `/img/${req.file.filename}`;
  }
  
  let newActive = item.active;
  if (active !== undefined) {
    newActive = (active == 1 || active === '1' || active === true) ? 1 : 0;
  }
  
  db.run(
    `UPDATE featured_items SET name=?, price=?, description=?, image=?, active=?, sort_order=? WHERE id=?`,
    [
      name || item.name,
      price !== undefined ? price : item.price,
      description !== undefined ? description : item.description,
      image,
      newActive,
      sort_order !== undefined ? sort_order : item.sort_order,
      req.params.id
    ]
  );
  saveDb();
  io.emit('featured:updated');
  res.json({ ok: true });
});

app.delete('/api/featured/:id', (req, res) => {
  const item = get('SELECT image FROM featured_items WHERE id = ?', [req.params.id]);
  if (item?.image?.startsWith('/img/')) {
    try { fs.unlinkSync(path.join(ROOT, 'public', item.image)); } catch(e) {}
  }
  db.run('DELETE FROM featured_items WHERE id = ?', [req.params.id]);
  saveDb();
  io.emit('featured:updated');
  res.json({ ok: true });
});

// ============================================================
// GARSON ÇAĞIRMA SİSTEMİ (tamamen kalıcı, ödeme ile otomatik temizlenir)
// ============================================================
app.post('/api/call-waiter', (req, res) => {
  const { tableId, tableName } = req.body;
  if (!tableId || !tableName) {
    return res.status(400).json({ error: 'Masa bilgisi eksik' });
  }

  const existing = get(
    'SELECT id FROM call_waiter WHERE table_id = ? AND status = "pending"',
    [tableId]
  );
  if (existing) {
    return res.status(409).json({ error: 'Bu masadan garson zaten çağrıldı.' });
  }

  db.run(
    'INSERT INTO call_waiter(table_id, table_name) VALUES(?, ?)',
    [tableId, tableName]
  );
  const newCall = get(
    'SELECT * FROM call_waiter WHERE id = ?',
    [lastId()]
  );
  saveDb();

  io.to('admin').emit('waiter:called', newCall);

  res.status(201).json({ success: true, call: newCall });
});

app.get('/api/calls', (req, res) => {
  const calls = all(
    'SELECT * FROM call_waiter WHERE status = "pending" ORDER BY created_at ASC'
  );
  res.json(calls);
});

app.delete('/api/calls/:id', (req, res) => {
  const call = get('SELECT * FROM call_waiter WHERE id = ?', [req.params.id]);
  if (!call) return res.status(404).json({ error: 'Çağrı bulunamadı' });

  db.run(
    'UPDATE call_waiter SET status = "resolved", resolved_at = datetime("now") WHERE id = ?',
    [req.params.id]
  );
  saveDb();
  io.to('admin').emit('waiter:resolved', { id: call.id, tableId: call.table_id });
  res.json({ success: true });
});

function clearWaiterCallsByTableId(tableId) {
  const calls = all('SELECT id FROM call_waiter WHERE table_id = ? AND status = "pending"', [tableId]);
  if (calls.length === 0) return;
  db.run(
    'UPDATE call_waiter SET status = "resolved", resolved_at = datetime("now") WHERE table_id = ? AND status = "pending"',
    [tableId]
  );
  saveDb();
  calls.forEach(call => {
    io.to('admin').emit('waiter:resolved', { id: call.id, tableId: tableId });
  });
}

// ============================================================
// YETKİLENDİRME MIDDLEWARE (GÜNCELLENDİ – session + token)
// ============================================================
function requireAuth(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (req.session.apiToken && req.session.apiToken === token) {
      return next();
    }
  }
  res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
}

function requirePageAuth(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (req.session.apiToken && req.session.apiToken === token) {
      return next();
    }
  }
  return res.redirect('/login');
}

// ============================================================
// AUTH (giriş, çıkış, şifre unuttum, sıfırlama)
// ============================================================
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' });
  }
  try {
    const user = get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre.' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.apiToken = token;
    req.session.save(err => {
      if (err) return res.status(500).json({ error: 'Oturum başlatılamadı.' });
      res.json({ success: true, username: user.username, token: token });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Çıkış yapılamadı.' });
    res.json({ success: true });
  });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'E-posta adresi gerekli.' });
  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) {
    return res.json({ success: true, message: 'E-posta adresinize şifre sıfırlama linki gönderildi.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 3600000;
  resetTokens.set(email, { token, expires, userId: user.id });
  const resetLink = `http://localhost:${PORT}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
  if (transporter) {
    try {
      await transporter.sendMail({
        from: '"Chef İstanbul" <noreply@chefistanbul.com>',
        to: email,
        subject: 'Şifre Sıfırlama',
        html: `<p>Şifrenizi sıfırlamak için <a href="${resetLink}">buraya tıklayın</a>. Bu link 1 saat geçerlidir.</p>`
      });
      console.log(`📧 Şifre sıfırlama e-postası gönderildi: ${email}`);
    } catch (err) {
      console.error('E-posta gönderme hatası:', err);
    }
  } else {
    console.log(`📧 [TEST MODE] Şifre sıfırlama linki: ${resetLink}`);
  }
  res.json({ success: true, message: 'E-posta adresinize şifre sıfırlama linki gönderildi.' });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, email, newPassword } = req.body;
  if (!token || !email || !newPassword) {
    return res.status(400).json({ error: 'Eksik bilgi.' });
  }
  const record = resetTokens.get(email);
  if (!record || record.token !== token || record.expires < Date.now()) {
    return res.status(400).json({ error: 'Geçersiz veya süresi dolmuş token.' });
  }
  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  const hashed = await bcrypt.hash(newPassword, 10);
  db.run('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);
  resetTokens.delete(email);
  saveDb();
  res.json({ success: true, message: 'Şifreniz başarıyla güncellendi.' });
});

// --- Ayarlar (GÜNCELLENDİ: admin_logo ve admin_title desteği) ---
app.get('/api/settings', (_, res) => res.json(getSettings()));

app.post('/api/settings', settingsUpload.fields([
  { name: 'restaurant_logo', maxCount: 1 },
  { name: 'kiosk_bg_image', maxCount: 1 },
  { name: 'kiosk_ambient_video', maxCount: 1 },
  { name: 'kiosk_screensaver_video', maxCount: 1 },
  { name: 'admin_logo', maxCount: 1 }
]), async (req, res) => {
  // 1. Metin ayarlarını kaydet (admin_title dahil)
  Object.entries(req.body).forEach(([k, v]) => setSetting(k, v));

  // 2. Dosya yüklemeleri ve çakışma temizliği
  if (req.files?.kiosk_ambient_video?.[0]) {
    const oldBgImage = getSetting('kiosk_bg_image');
    if (oldBgImage && oldBgImage.startsWith('/img/')) {
      try { fs.unlinkSync(path.join(ROOT, 'public', oldBgImage)); } catch(e) {}
    }
    setSetting('kiosk_bg_image', '');
    setSetting('kiosk_ambient_video', `/videos/${req.files.kiosk_ambient_video[0].filename}`);
  }
  if (req.files?.kiosk_bg_image?.[0]) {
    const oldVideo = getSetting('kiosk_ambient_video');
    if (oldVideo && oldVideo.startsWith('/videos/')) {
      try { fs.unlinkSync(path.join(ROOT, 'public', oldVideo)); } catch(e) {}
    }
    setSetting('kiosk_ambient_video', '');
    setSetting('kiosk_bg_image', `/img/${req.files.kiosk_bg_image[0].filename}`);
  }
  if (req.files?.restaurant_logo?.[0]) {
    setSetting('restaurant_logo', `/img/${req.files.restaurant_logo[0].filename}`);
  }
  if (req.files?.kiosk_screensaver_video?.[0]) {
    setSetting('kiosk_screensaver_video', `/videos/${req.files.kiosk_screensaver_video[0].filename}`);
  }
  if (req.files?.admin_logo?.[0]) {
    setSetting('admin_logo', `/img/${req.files.admin_logo[0].filename}`);
  }

  // 3. Kaldırma işlemleri (flag ile)
  if (req.body.remove_restaurant_logo === '1') {
    const old = getSetting('restaurant_logo');
    if (old && old.startsWith('/img/')) {
      try { fs.unlinkSync(path.join(ROOT, 'public', old)); } catch(e) {}
    }
    setSetting('restaurant_logo', '');
  }
  if (req.body.remove_kiosk_bg_image === '1') {
    const old = getSetting('kiosk_bg_image');
    if (old && old.startsWith('/img/')) {
      try { fs.unlinkSync(path.join(ROOT, 'public', old)); } catch(e) {}
    }
    setSetting('kiosk_bg_image', '');
  }
  if (req.body.remove_ambient_video === '1') {
    const old = getSetting('kiosk_ambient_video');
    if (old && old.startsWith('/videos/')) {
      try { fs.unlinkSync(path.join(ROOT, 'public', old)); } catch(e) {}
    }
    setSetting('kiosk_ambient_video', '');
  }
  if (req.body.remove_screensaver_video === '1') {
    const old = getSetting('kiosk_screensaver_video');
    if (old && old.startsWith('/videos/')) {
      try { fs.unlinkSync(path.join(ROOT, 'public', old)); } catch(e) {}
    }
    setSetting('kiosk_screensaver_video', '');
  }
  if (req.body.remove_admin_logo === '1') {
    const old = getSetting('admin_logo');
    if (old && old.startsWith('/img/')) {
      try { fs.unlinkSync(path.join(ROOT, 'public', old)); } catch(e) {}
    }
    setSetting('admin_logo', '');
  }

  const s = getSettings();
  io.emit('settings:updated', s);
  io.emit('videos:updated');
  res.json({ ok: true, settings: s });
});

app.post('/api/settings/remove-video', (req, res) => {
  const { key } = req.body;
  if (!['kiosk_ambient_video', 'kiosk_screensaver_video'].includes(key)) {
    return res.status(400).json({ error: 'Geçersiz video anahtarı' });
  }
  const val = getSetting(key);
  if (val && val.startsWith('/videos/')) {
    try { fs.unlinkSync(path.join(ROOT, 'public', val)); } catch(e) {}
  }
  setSetting(key, '');
  io.emit('settings:updated', getSettings());
  io.emit('videos:updated');
  res.json({ ok: true });
});

app.post('/api/settings/remove-image', (req, res) => {
  const { key } = req.body;
  if (!['restaurant_logo','kiosk_bg_image','admin_logo'].includes(key))
    return res.status(400).json({ error:'Geçersiz key' });
  const val = getSetting(key);
  if (val?.startsWith('/img/')) { try { fs.unlinkSync(path.join(ROOT,'public',val)); } catch(_){} }
  setSetting(key,'');
  io.emit('settings:updated', getSettings());
  res.json({ ok:true });
});

app.post('/api/settings/upload-sound', sndUpload.single('sound'), (req, res) => {
  if (!req.file) return res.status(400).json({ error:'Ses dosyası gerekli' });
  setSetting('custom_sound_url', `/sounds/${req.file.filename}`);
  setSetting('notification_snd', 'custom');
  res.json({ ok:true, url:`/sounds/${req.file.filename}` });
});

// --- Kategoriler (requireAuth) ---
app.get('/api/categories', requireAuth, (_, res) =>
  res.json(all('SELECT * FROM categories ORDER BY sort_order,id')));

app.post('/api/categories', requireAuth, imgUpload.single('image'), (req, res) => {
  const { name, icon='fa-utensils', color='#f97316', sort_order=0 } = req.body;
  if (!name) return res.status(400).json({ error:'Ad gerekli' });
  const image = req.file ? `/img/${req.file.filename}` : '';
  db.run('INSERT INTO categories(name,icon,color,image,sort_order) VALUES(?,?,?,?,?)',
    [name, icon, color, image, +sort_order]);
  const id = lastId(); saveDb();
  io.emit('menu:updated');
  res.json({ id, name, icon, color, image, sort_order:+sort_order });
});

app.put('/api/categories/:id', requireAuth, imgUpload.single('image'), (req, res) => {
  const c = get('SELECT * FROM categories WHERE id=?',[+req.params.id]);
  if (!c) return res.status(404).json({ error:'Bulunamadı' });
  const { name, icon, color, sort_order, remove_image } = req.body;
  let image = c.image;
  if (remove_image === '1') {
    if (image && image.startsWith('/img/')) { try { fs.unlinkSync(path.join(ROOT,'public',image)); } catch(_){} }
    image = '';
  } else if (req.file) image = `/img/${req.file.filename}`;
  db.run('UPDATE categories SET name=?,icon=?,color=?,image=?,sort_order=? WHERE id=?',
    [name||c.name, icon||c.icon, color||c.color, image, sort_order!==undefined?+sort_order:c.sort_order, +req.params.id]);
  saveDb();
  io.emit('menu:updated');
  res.json({ ok:true });
});

app.delete('/api/categories/:id', requireAuth, (req, res) => {
  const cat = get('SELECT image FROM categories WHERE id=?',[+req.params.id]);
  if (cat?.image?.startsWith('/img/')) { try { fs.unlinkSync(path.join(ROOT,'public',cat.image)); } catch(_){} }
  db.run('DELETE FROM categories WHERE id=?',[+req.params.id]);
  saveDb();
  io.emit('menu:updated');
  res.json({ ok:true });
});

// --- Ürünler (requireAuth) ---
app.get('/api/products', requireAuth, (req, res) => {
  let sql = `SELECT p.*,c.name as category_name,c.icon as category_icon,c.color as category_color
    FROM products p LEFT JOIN categories c ON p.category_id=c.id`;
  const params = [];
  if (req.query.category_id) { sql += ' WHERE p.category_id=?'; params.push(+req.query.category_id); }
  sql += ' ORDER BY p.sort_order,p.id';
  res.json(all(sql, params));
});

app.post('/api/products', requireAuth, imgUpload.single('image'), (req, res) => {
  const { name, price, cost=0, category_id, description='', available=1, sort_order=0 } = req.body;
  if (!name) return res.status(400).json({ error:'Ad gerekli' });
  const image = req.file ? `/img/${req.file.filename}` : '';
  db.run('INSERT INTO products(category_id,name,price,cost,image,description,available,sort_order) VALUES(?,?,?,?,?,?,?,?)',
    [category_id?+category_id:null, name, +(price||0), +(cost||0), image, description, available?1:0, +sort_order]);
  const id = lastId(); saveDb();
  io.emit('menu:updated');
  res.json({ id, name, price:+(price||0), image });
});

app.put('/api/products/:id', requireAuth, imgUpload.single('image'), (req, res) => {
  const p = get('SELECT * FROM products WHERE id=?',[+req.params.id]);
  if (!p) return res.status(404).json({ error:'Bulunamadı' });
  const { name, price, cost, category_id, description, available, sort_order, remove_image } = req.body;
  let image = p.image;
  if (remove_image === '1') {
    if (image && image.startsWith('/img/')) { try { fs.unlinkSync(path.join(ROOT,'public',image)); } catch(_){} }
    image = '';
  } else if (req.file) image = `/img/${req.file.filename}`;
  db.run(`UPDATE products SET name=?,price=?,cost=?,category_id=?,image=?,description=?,available=?,sort_order=? WHERE id=?`,
    [name||p.name, price!==undefined?+(price):p.price, cost!==undefined?+(cost):p.cost,
     category_id?+category_id:p.category_id, image, description!==undefined?description:p.description,
     available!==undefined?(available?1:0):p.available, sort_order!==undefined?+sort_order:p.sort_order, +req.params.id]);
  saveDb(); io.emit('menu:updated');
  res.json({ ok:true });
});

app.delete('/api/products/:id', requireAuth, (req, res) => {
  const p = get('SELECT * FROM products WHERE id=?',[+req.params.id]);
  if (p?.image?.startsWith('/img/')) { try { fs.unlinkSync(path.join(ROOT,'public',p.image)); } catch(_){} }
  db.run('DELETE FROM products WHERE id=?',[+req.params.id]);
  saveDb(); io.emit('menu:updated');
  res.json({ ok:true });
});

// --- Masalar (requireAuth) ---
app.get('/api/tables', requireAuth, (_, res) =>
  res.json(all('SELECT * FROM tables WHERE active=1 ORDER BY id')));

app.post('/api/tables', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error:'Ad gerekli' });
  const slug = createSlugFromName(name);
  let finalSlug = slug;
  let counter = 1;
  while (get('SELECT id FROM tables WHERE slug=?', [finalSlug])) {
    finalSlug = `${slug}-${counter++}`;
  }
  db.run('INSERT INTO tables(name, slug) VALUES(?,?)', [name, finalSlug]);
  const id = lastId(); saveDb();
  res.json({ id, name, slug: finalSlug });
});

app.delete('/api/tables/:id', requireAuth, (req, res) => {
  db.run('UPDATE tables SET active=0 WHERE id=?',[+req.params.id]);
  saveDb(); res.json({ ok:true });
});

// --- Siparişler (requireAuth) ---
app.get('/api/orders', requireAuth, (req, res) => {
  const status = req.query.status || 'pending';
  let orders;
  if (status === 'pending') {
    orders = all('SELECT * FROM orders WHERE status IN ("pending", "preparing") ORDER BY id DESC LIMIT 200');
  } else if (status === 'accepted') {
    orders = all('SELECT * FROM orders WHERE status IN ("delivered", "completed") ORDER BY id DESC LIMIT 200');
  } else if (status === 'all') {
    orders = all('SELECT * FROM orders ORDER BY id DESC LIMIT 200');
  } else {
    orders = all('SELECT * FROM orders WHERE status = ? ORDER BY id DESC LIMIT 200', [status]);
  }
  orders.forEach(o => {
    o.items = all('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
  });
  res.json(orders);
});

app.post('/api/orders/:id/accept', requireAuth, (req, res) => {
  const order = get('SELECT * FROM orders WHERE id=?', [+req.params.id]);
  if (!order) return res.status(404).json({ error: 'Bulunamadı' });
  db.run("UPDATE orders SET status='preparing', accepted_at=datetime('now') WHERE id=?", [+req.params.id]);
  const items = all('SELECT * FROM order_items WHERE order_id=?', [+req.params.id]);
  items.forEach(item =>
    db.run('INSERT INTO tab_items(table_id,table_name,product_id,name,price,cost,image,quantity) VALUES(?,?,?,?,?,?,?,?)',
      [order.table_id, order.table_name, item.product_id, item.name, item.price, item.cost, item.image, item.quantity]));
  saveDb();
  io.emit('order:status-updated', { orderId: order.id, status: 'preparing', tableId: order.table_id });
  io.to(`kiosk:${order.table_id}`).emit('order:status-updated', { orderId: order.id, status: 'preparing' });
  const tab = all('SELECT * FROM tab_items WHERE table_id=?', [order.table_id]);
  const tabTotal = tab.reduce((s,i)=>s+i.price*i.quantity,0);
  io.to(`kiosk:${order.table_id}`).emit('tab:updated', { items:tab, total:tabTotal });
  res.json({ ok:true });
});

app.put('/api/orders/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  const allowed = ['preparing', 'on_the_way', 'delivered'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Geçersiz durum. Şunlardan biri olmalı: preparing, on_the_way, delivered' });
  }
  const order = get('SELECT * FROM orders WHERE id=?', [+req.params.id]);
  if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
  
  db.run('UPDATE orders SET status=? WHERE id=?', [status, +req.params.id]);
  
  // *** DÜZELTİLDİ: delivered olduğunda paid=1 YAPMA, sadece salesCount güncelle ***
  if (status === 'delivered') {
    await updateSalesCountForOrder(order.id);
    // paid=1 burada yapılmıyor, ödeme başarılı olduğunda webhook veya adisyon kapatmada yapılacak.
    // Yine de siparişin teslim edildiğini belirtmek için status delivered yeterli.
    saveDb();
    io.emit('most-sold:updated');
  }
  
  saveDb();
  io.emit('order:status-updated', { orderId: order.id, status, tableId: order.table_id });
  io.to(`kiosk:${order.table_id}`).emit('order:status-updated', { orderId: order.id, status });
  res.json({ ok: true });
});

app.post('/api/orders/:id/reject', requireAuth, (req, res) => {
  db.run("UPDATE orders SET status='rejected' WHERE id=?",[+req.params.id]);
  const o = get('SELECT * FROM orders WHERE id=?',[+req.params.id]);
  saveDb(); io.emit('order:rejected',{ orderId:+req.params.id, tableId:o?.table_id });
  res.json({ ok:true });
});

// ✅ TOPLU SİLME (BULK DELETE) - Siparişler
app.post('/api/orders/bulk-delete', requireAuth, (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Geçerli ID listesi gönderin' });
  }
  try {
    const placeholders = ids.map(() => '?').join(',');
    // Önce order_items sil (foreign key ilişkisi yoksa da direkt silinebilir)
    db.run(`DELETE FROM order_items WHERE order_id IN (${placeholders})`, ids);
    // Sonra orders sil
    db.run(`DELETE FROM orders WHERE id IN (${placeholders})`, ids);
    saveDb();
    res.json({ success: true, deletedCount: ids.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Silme işlemi başarısız' });
  }
});

// --- Adisyon (Tab) (requireAuth) ---
app.get('/api/tab/:tableId', requireAuth, (req, res) => {
  const items = all('SELECT * FROM tab_items WHERE table_id=? ORDER BY id',[+req.params.tableId]);
  const total = items.reduce((s,i)=>s+i.price*i.quantity,0);
  res.json({ items, total });
});

app.post('/api/tab/:tableId/close', requireAuth, async (req, res) => {
  const tableId = +req.params.tableId;
  const { payment_type='cash' } = req.body;
  const tbl = get('SELECT * FROM tables WHERE id=?', [tableId]);
  const items = all('SELECT * FROM tab_items WHERE table_id=?', [tableId]);
  if (!items.length) return res.status(400).json({ error:'Adisyon boş' });
  const total = items.reduce((s,i)=>s+i.price*i.quantity,0);
  const cost  = items.reduce((s,i)=>s+(i.cost||0)*i.quantity,0);
  
  db.run('INSERT INTO sales(table_id,table_name,total,cost,payment_type,items_json) VALUES(?,?,?,?,?,?)',
    [tableId, tbl?.name||'Bilinmiyor', total, cost, payment_type, JSON.stringify(items)]);
  
  db.run('DELETE FROM tab_items WHERE table_id=?', [tableId]);
  
  const ordersToComplete = all('SELECT id FROM orders WHERE table_id = ? AND status IN ("delivered","preparing","on_the_way")', [tableId]);
  for (const ord of ordersToComplete) {
    await updateSalesCountForOrder(ord.id);
    db.run("UPDATE orders SET paid = 1, status = 'completed' WHERE id = ?", [ord.id]);
  }
  
  clearWaiterCallsByTableId(tableId);
  
  saveDb();
  
  io.emit('most-sold:updated');
  io.emit('tab:closed',{ tableId });
  io.to(`kiosk:${tableId}`).emit('tab:closed', { tableId });
  io.to(`kiosk:${tableId}`).emit('tab:updated',{ items:[], total:0 });
  
  res.json({ ok:true, total, cost, items, table_name:tbl?.name||'' });
});

// --- Satış Raporu (requireAuth) ---
app.get('/api/sales/report', requireAuth, (_, res) => {
  const all_sales = all('SELECT * FROM sales ORDER BY id DESC LIMIT 500');
  const today = new Date().toISOString().split('T')[0];
  const todaySales = all_sales.filter(s => s.created_at && s.created_at.startsWith(today));
  const totalRevenue = all_sales.reduce((s,x)=>s+x.total,0);
  const totalCost    = all_sales.reduce((s,x)=>s+(x.cost||0),0);
  const todayRevenue = todaySales.reduce((s,x)=>s+x.total,0);
  const avgOrder     = all_sales.length ? totalRevenue/all_sales.length : 0;
  res.json({
    totalRevenue, totalCost, netProfit: totalRevenue-totalCost,
    totalOrders: all_sales.length,
    todayRevenue, todayOrders: todaySales.length,
    avgOrder, sales: all_sales
  });
});

// ✅ TOPLU SİLME (BULK DELETE) - Satışlar
app.post('/api/sales/bulk-delete', requireAuth, (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Geçerli ID listesi gönderin' });
  }
  try {
    const placeholders = ids.map(() => '?').join(',');
    db.run(`DELETE FROM sales WHERE id IN (${placeholders})`, ids);
    saveDb();
    res.json({ success: true, deletedCount: ids.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Silme işlemi başarısız' });
  }
});

// --- POPÜLER ÜRÜNLER (requireAuth) ---
app.get('/api/most-sold-products', requireAuth, async (req, res) => {
  const limit = parseInt(req.query.limit) || 6;
  const mostSold = all(`
    SELECT id, name, price, image, salesCount,
           (SELECT COALESCE(SUM(quantity),0) FROM order_items WHERE product_id = products.id) as total_orders
    FROM products
    WHERE available = 1
    ORDER BY salesCount DESC, total_orders DESC
    LIMIT ?
  `, [limit]);
  res.json(mostSold);
});

// ============================================================
// ÖDEME ENDPOINT'LERİ (requireAuth)
// ============================================================
app.post('/api/payment/initiate', requireAuth, async (req, res) => {
  const { tableId, tipAmount = 0 } = req.body;
  if (!tableId) return res.status(400).json({ error: 'tableId gerekli' });

  try {
    // *** DÜZELTİLDİ: paid kontrolü kaldırıldı, sadece table_id'ye göre toplam alınıyor ***
    const result = get(`
      SELECT SUM(oi.price * oi.quantity) as total
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      WHERE o.table_id = ?
    `, [tableId]);
    const baseAmount = result?.total || 0;
    if (baseAmount === 0) {
      const orderCount = get('SELECT COUNT(*) as cnt FROM orders WHERE table_id = ?', [tableId])?.cnt || 0;
      return res.status(400).json({ 
        error: `Ödenecek sipariş bulunamadı. (${orderCount} adet sipariş var, ancak toplam tutar 0)`
      });
    }

    const totalAmount = baseAmount + Number(tipAmount);
    const transactionId = uuid();

    const paymentLink = await paymentProvider.createPaymentLink(tableId, totalAmount, tipAmount, baseAmount, transactionId, req);

    db.run(
      `INSERT INTO payment_transactions(transaction_id, table_id, amount, tip, payment_link)
       VALUES(?, ?, ?, ?, ?)`,
      [transactionId, tableId, totalAmount, tipAmount, paymentLink]
    );
    saveDb();

    res.json({
      paymentLink,
      transactionId,
      baseAmount,
      totalAmount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ödeme başlatılamadı: ' + err.message });
  }
});

app.post('/api/payment/webhook', async (req, res) => {
  const token = req.headers['x-webhook-token'];
  if (process.env.PAYMENT_WEBHOOK_TOKEN && token !== process.env.PAYMENT_WEBHOOK_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await paymentProvider.handleWebhook(req, res);
    if (result && result.success) {
      const tx = get('SELECT * FROM payment_transactions WHERE transaction_id = ?', [result.transactionId]);
      if (tx) {
        db.run(`UPDATE orders SET paid = 1 WHERE table_id = ? AND paid = 0`, [tx.table_id]);
        db.run(`UPDATE payment_transactions SET status = 'success' WHERE transaction_id = ?`, [result.transactionId]);
        
        const ordersToUpdate = all('SELECT id FROM orders WHERE table_id = ? AND paid = 1 AND status != "completed"', [tx.table_id]);
        for (const ord of ordersToUpdate) {
          await updateSalesCountForOrder(ord.id);
          db.run("UPDATE orders SET status = 'completed' WHERE id = ?", [ord.id]);
        }
        
        clearWaiterCallsByTableId(tx.table_id);
        
        saveDb();
        
        io.emit('most-sold:updated');
        io.to(`kiosk:${tx.table_id}`).emit('PAYMENT_SUCCESS', {
          tableId: tx.table_id,
          transactionId: result.transactionId,
          amount: tx.amount
        });
        console.log(`✅ Ödeme başarılı: Masa ${tx.table_id}, İşlem ${result.transactionId}`);
      }
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Webhook işlenemedi' });
  }
});

app.get('/api/payment/iyzico-callback', async (req, res) => {
  const { conversationId } = req.query;
  res.redirect(`/payment-status?tid=${conversationId}&status=success`);
});

// ============================================================
// KULLANICI YÖNETİMİ (requireAuth)
// ============================================================
app.get('/api/users', requireAuth, (req, res) => {
  const users = all('SELECT id, username, email, created_at FROM users ORDER BY id');
  res.json(users);
});

app.post('/api/users', requireAuth, async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
  const existingUser = get('SELECT id FROM users WHERE username = ?', [username]);
  if (existingUser) return res.status(400).json({ error: 'Bu kullanıcı adı zaten alınmış' });
  if (email) {
    const existingEmail = get('SELECT id FROM users WHERE email = ?', [email]);
    if (existingEmail) return res.status(400).json({ error: 'Bu e-posta adresi zaten kullanılıyor' });
  }
  const hashed = await bcrypt.hash(password, 10);
  db.run('INSERT INTO users(username, password, email) VALUES(?,?,?)', [username, hashed, email || null]);
  const id = lastId();
  saveDb();
  res.status(201).json({ id, username, email });
});

app.delete('/api/users/:id', requireAuth, (req, res) => {
  const id = +req.params.id;
  const user = get('SELECT username FROM users WHERE id = ?', [id]);
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  if (user.username === 'admin') return res.status(403).json({ error: 'Ana admin silinemez' });
  db.run('DELETE FROM users WHERE id = ?', [id]);
  saveDb();
  res.json({ success: true });
});

app.put('/api/users/change-username', requireAuth, async (req, res) => {
  const { newUsername, password } = req.body;
  if (!newUsername) return res.status(400).json({ error: 'Yeni kullanıcı adı gerekli' });
  if (!password) return res.status(400).json({ error: 'Şifre gerekli' });
  try {
    const user = get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Şifre yanlış' });
    const existing = get('SELECT id FROM users WHERE username = ?', [newUsername]);
    if (existing && existing.id !== req.session.userId) {
      return res.status(400).json({ error: 'Bu kullanıcı adı zaten alınmış' });
    }
    db.run('UPDATE users SET username = ? WHERE id = ?', [newUsername, req.session.userId]);
    saveDb();
    req.session.username = newUsername;
    res.json({ success: true, username: newUsername });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

app.put('/api/users/change-password', requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Eski ve yeni şifre gerekli' });
  try {
    const user = get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Eski şifre yanlış' });
    const hashed = await bcrypt.hash(newPassword, 10);
    db.run('UPDATE users SET password = ? WHERE id = ?', [hashed, req.session.userId]);
    saveDb();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// ============================================================
// SAYFALAR (ROUTE) KORUMALI
// ============================================================
app.get('/admin', requirePageAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
app.get('/', requirePageAuth, (_, res) => res.redirect('/admin'));

app.get('/login', (_, res) => res.sendFile(path.join(ROOT, 'public', 'login.html')));
app.get('/reset-password', (_, res) => res.sendFile(path.join(ROOT, 'public', 'reset-password.html')));

// KIOSK ROUTE - DÜZELTİLDİ
app.get('/kiosk/:slug', (req, res) => {
  const t = get('SELECT * FROM tables WHERE slug=? AND active=1', [req.params.slug]);
  if (!t) {
    return res.status(404).send(`
      <html>
        <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#fff;margin:0">
          <div style="text-align:center">
            <h1>404</h1>
            <p>Bu masa bulunamadı veya aktif değil.</p>
            <a href="/admin" style="color:#f97316">Admin paneline dön</a>
          </div>
        </body>
      </html>
    `);
  }
  const kioskPath = path.join(ROOT, 'public', 'kiosk.html');
  if (!fs.existsSync(kioskPath)) {
    return res.status(500).send(`
      <html>
        <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#fff;margin:0">
          <div style="text-align:center">
            <h1>500</h1>
            <p>kiosk.html dosyası eksik. Lütfen dosyayı public klasörüne ekleyin.</p>
          </div>
        </body>
      </html>
    `);
  }
  res.sendFile(kioskPath);
});

// ============================================================
// SOCKET.IO
// ============================================================
io.on('connection', socket => {
  socket.on('join:admin', ()         => socket.join('admin'));
  socket.on('join:kiosk', ({ tableId }) => socket.join(`kiosk:${tableId}`));
  socket.on('order:new', ({ tableId, tableName, items, note }) => {
    if (!items?.length) return;
    const total = items.reduce((s,i)=>s+i.price*i.quantity,0);
    db.run('INSERT INTO orders(table_id,table_name,total,note) VALUES(?,?,?,?)',
      [tableId, tableName, total, note||'']);
    const orderId = lastId();
    items.forEach(item =>
      db.run('INSERT INTO order_items(order_id,product_id,name,price,cost,image,quantity) VALUES(?,?,?,?,?,?,?)',
        [orderId, item.id, item.name, item.price, item.cost||0, item.image||'', item.quantity]));
    saveDb();
    const fullOrder = {
      id:orderId, table_id:tableId, table_name:tableName,
      total, note:note||'', status:'pending',
      created_at: new Date().toISOString(),
      items: items.map(i=>({ name:i.name, price:i.price, image:i.image||'', quantity:i.quantity }))
    };
    io.to('admin').emit('order:incoming', fullOrder);
    console.log(`[Sipariş #${orderId}] ${tableName} → ${items.length} ürün ₺${total.toFixed(2)}`);
  });
  socket.on('disconnect', () => {});
});

// ============================================================
// VERİTABANI BAŞLATMA VE SUNUCUYU ÇALIŞTIRMA
// ============================================================
async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) { db = new SQL.Database(fs.readFileSync(DB_FILE)); console.log('✅ Veritabanı yüklendi'); }
  else { db = new SQL.Database(); console.log('✅ Yeni veritabanı oluşturuldu'); }

  // Tablolar
  db.run(`CREATE TABLE IF NOT EXISTS categories(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, icon TEXT DEFAULT 'fa-utensils',
    color TEXT DEFAULT '#f97316', image TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS products(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER, name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0, cost REAL DEFAULT 0,
    image TEXT DEFAULT '', description TEXT DEFAULT '',
    available INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0,
    salesCount INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS tables(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, active INTEGER DEFAULT 1
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS orders(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER, table_name TEXT NOT NULL,
    status TEXT DEFAULT 'pending', total REAL DEFAULT 0,
    note TEXT DEFAULT '', created_at TEXT DEFAULT(datetime('now')), accepted_at TEXT,
    paid INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS order_items(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER, product_id INTEGER,
    name TEXT NOT NULL, price REAL NOT NULL, cost REAL DEFAULT 0,
    image TEXT DEFAULT '', quantity INTEGER DEFAULT 1
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS tab_items(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER, table_name TEXT NOT NULL,
    product_id INTEGER, name TEXT NOT NULL,
    price REAL NOT NULL, cost REAL DEFAULT 0,
    image TEXT DEFAULT '', quantity INTEGER DEFAULT 1,
    added_at TEXT DEFAULT(datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS sales(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER, table_name TEXT NOT NULL,
    total REAL NOT NULL, cost REAL DEFAULT 0,
    payment_type TEXT DEFAULT 'cash',
    items_json TEXT DEFAULT '[]',
    created_at TEXT DEFAULT(datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT UNIQUE,
    created_at TEXT DEFAULT(datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS payment_transactions(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT UNIQUE NOT NULL,
    table_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    tip REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    payment_link TEXT,
    created_at TEXT DEFAULT(datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS featured_items(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    description TEXT DEFAULT '',
    image TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT(datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS call_waiter(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL,
    table_name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT(datetime('now')),
    resolved_at TEXT
  )`);

  // Migration: products tablosuna salesCount eklenmemişse ekle
  const hasSalesCount = get("SELECT COUNT(*) as cnt FROM pragma_table_info('products') WHERE name='salesCount'")?.cnt;
  if (!hasSalesCount) {
    db.run("ALTER TABLE products ADD COLUMN salesCount INTEGER DEFAULT 0");
    saveDb();
    console.log("✅ products tablosuna salesCount eklendi");
  }

  // Varsayılan ayarlar (admin_logo ve admin_title eklendi)
  const defs = {
    restaurant_name:  'Chef İstanbul',
    restaurant_logo:  '',
    kiosk_bg_color:   '#0f172a',
    kiosk_bg_image:   '',
    kiosk_ambient_video: '',
    kiosk_screensaver_video: '',
    screensaver_timeout: '30',
    kiosk_btn_color:  '#f97316',
    kiosk_accent:     '#fb923c',
    kiosk_slogan:     'Hoş Geldiniz! Hemen siparişe başla, sıcacık masana gelsin.',
    footer_text:      'Afiyet olsun! Tekrar bekleriz.',
    welcome_footer_text: 'Chef İstanbul © 2026',
    notification_on:  '1',
    notification_vol: '0.8',
    notification_snd: 'default',
    custom_sound_url: '',
    external_ip:      '',
    featured_title:   '🍽️ Öne Çıkanlar',
    admin_logo:       '',
    admin_title:      'Chef İstanbul'
  };
  Object.entries(defs).forEach(([k,v]) => db.run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)',[k,v]));

  // Admin kullanıcı
  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  db.run(
    `INSERT OR IGNORE INTO users(username, password, email) 
     VALUES('admin', ?, 'admin@chefistanbul.com')`,
    [adminPasswordHash]
  );
  const existingAdmin = get('SELECT id, email FROM users WHERE username = ?', ['admin']);
  if (existingAdmin && (!existingAdmin.email || existingAdmin.email !== 'admin@chefistanbul.com')) {
    db.run('UPDATE users SET email = ? WHERE username = ?', ['admin@chefistanbul.com', 'admin']);
    saveDb();
    console.log('✅ Admin email adresi güncellendi');
  }
  console.log('✅ Admin kullanıcı hazır (kullanıcı adı: admin / şifre: admin123)');

  // Örnek veriler (kategoriler ve ürünler zaten varsa ekleme)
  if (get('SELECT COUNT(*) as c FROM categories').c === 0) {
    const cats = [
      ['Burgerlar','fa-burger','#f97316'],
      ['Pizzalar','fa-pizza-slice','#ef4444'],
      ['İçecekler','fa-glass-water','#3b82f6'],
      ['Tatlılar','fa-ice-cream','#ec4899'],
      ['Vegan','fa-leaf','#22c55e'],
      ['Kahvaltı','fa-egg','#f59e0b'],
    ];
    cats.forEach(([name,icon,color]) => db.run('INSERT INTO categories(name,icon,color) VALUES(?,?,?)',[name,icon,color]));

    const getcat = n => get('SELECT id FROM categories WHERE name=?',[n]).id;
    const B=getcat('Burgerlar'), P=getcat('Pizzalar'), I=getcat('İçecekler'),
          T=getcat('Tatlılar'), V=getcat('Vegan'), K=getcat('Kahvaltı');

    const prods = [
      [B,'Klasik Burger',120,45,'Dana eti, marul, domates, özel sos'],
      [B,'BBQ Burger',145,55,'Dana eti, cheddar, bbq sos, soğan'],
      [B,'Double Smash',175,70,'Çift dana köfte, özel sos, turşu'],
      [P,'Margarita Pizza',130,40,'Domates sosu, mozzarella, fesleğen'],
      [P,'Karışık Pizza',165,55,'Pepperoni, mantar, biber, mozzarella'],
      [I,'Kola',35,8,'330ml soğuk kutu'],
      [I,'Ayran',25,5,'Taze ev yapımı'],
      [I,'Limonata',45,10,'Taze sıkılmış'],
      [I,'Su',15,2,'500ml'],
      [T,'Cheesecake',75,20,'Frambuazlı N.Y. cheesecake'],
      [T,'Sufle',65,18,'Çikolatalı sıcak sufle'],
      [V,'Vegan Bowl',110,35,'Kinoa, avokado, sebzeler'],
      [V,'Falafel Dürüm',95,30,'Falafel, tahin, taze sebze'],
      [K,'Serpme Kahvaltı',180,60,'Tam serpme 2 kişilik'],
      [K,'Menemen',75,20,'Domates, biber, yumurta'],
    ];
    prods.forEach(([cid,name,price,cost,desc]) =>
      db.run('INSERT INTO products(category_id,name,price,cost,description) VALUES(?,?,?,?,?)',[cid,name,price,cost,desc]));

    const tableNames = ['Masa 1','Masa 2','Masa 3','Masa 4','Bar 1','Teras 1'];
    tableNames.forEach(name => {
      const slug = createSlugFromName(name);
      db.run('INSERT OR IGNORE INTO tables(name,slug) VALUES(?,?)', [name, slug]);
    });
    saveDb();
    console.log('✅ Örnek veriler yüklendi');
  } else { saveDb(); }
}

function createBatFile() {
  const bat = `@echo off
title Chef İstanbul - Restoran Kiosk Sistemi
color 0A
echo.
echo  =====================================
echo    Chef İstanbul Baslatiliyor...
echo  =====================================
echo.
cd /d "%~dp0"
start "" "http://localhost:${PORT}/admin"
npm start
pause
`;
  fs.writeFileSync(path.join(ROOT, 'Chef_Istanbul_Baslat.bat'), bat, 'utf8');
  console.log('✅ Chef_Istanbul_Baslat.bat oluşturuldu');
}

initDb().then(async () => {
  await initEmailTransporter();
  createBatFile();
  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║  🍽️  Chef İstanbul — Hazır!                   ║');
    console.log(`║  🌐  http://localhost:${PORT}                  ║`);
    console.log(`║  📊  Admin: http://localhost:${PORT}/admin      ║`);
    console.log(`║  🔐  Login: http://localhost:${PORT}/login      ║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
  });
}).catch(e => { console.error('Başlatma hatası:', e); process.exit(1); });