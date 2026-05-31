# ⬡ DriveLink

مقصّر روابط مخصص لـ Google Drive مع تتبع النقرات في الوقت الفعلي.

---

## المميزات

- **تقصير روابط Google Drive** — يدعم Drive, Docs, Sheets, Slides, Forms
- **تتبع النقرات** — عدد النقرات، آخر نقرة، IP، User-Agent
- **لوحة تحكم** — جدول كامل بجميع الروابط مع رسوم بيانية
- **رمز QR** — لكل رابط مقصّر مع خيار التحميل
- **اسم مخصص** — اختر slug خاص بك (مثال: `/r/ملف-المشروع`)
- **تاريخ انتهاء** — يوم / أسبوع / شهر أو بدون انتهاء
- **تصدير CSV** — تصدير جميع البيانات
- **Rate Limiting** — حماية من الإساءة
- **قاعدة بيانات SQLite** — سريعة، لا تحتاج إعداد خادم قاعدة بيانات

---

## هيكل المشروع

```
drivelink/
├── api/
│   └── server.js        ← Node.js/Express backend
├── public/
│   ├── index.html       ← الواجهة الأمامية (SPA)
│   ├── style.css        ← التصميم
│   └── app.js           ← منطق الواجهة + LocalStorage fallback
├── db/                  ← قاعدة بيانات SQLite (مُنشأة تلقائياً)
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## التثبيت والتشغيل

### المتطلبات
- Node.js 18+
- npm أو yarn

### الخطوات

```bash
# 1. استنساخ المستودع
git clone https://github.com/YOUR_USERNAME/drivelink.git
cd drivelink

# 2. تثبيت الحزم
npm install

# 3. إعداد المتغيرات البيئية
cp .env.example .env
# عدّل BASE_URL في .env إلى نطاقك

# 4. إنشاء مجلد قاعدة البيانات
mkdir -p db

# 5. تشغيل الخادم
npm start
# أو للتطوير مع إعادة تشغيل تلقائية:
npm run dev
```

افتح المتصفح على: `http://localhost:3000`

---

## API Reference

### إنشاء رابط مقصّر
```http
POST /api/links
Content-Type: application/json

{
  "longUrl": "https://drive.google.com/file/d/ABC123/view",
  "customSlug": "ملف-مشروع",   // اختياري
  "expiryDays": 7               // اختياري: 1 | 7 | 30
}
```

**الاستجابة:**
```json
{
  "slug": "ملف-مشروع",
  "shortUrl": "https://drivelink.io/r/ملف-مشروع",
  "longUrl": "https://drive.google.com/file/d/ABC123/view",
  "expiresAt": 1718000000000
}
```

### جلب جميع الروابط
```http
GET /api/links
```

### جلب رابط مع تفاصيل النقرات
```http
GET /api/links/:slug
```

### حذف رابط
```http
DELETE /api/links/:slug
```

### الإحصائيات العامة
```http
GET /api/stats
```

---

## الاستضافة على GitHub Pages (Netlify/Vercel)

### Vercel (مجاناً)

```bash
npm install -g vercel
vercel --prod
```

أضف `vercel.json`:
```json
{
  "builds": [{ "src": "api/server.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "api/server.js" }]
}
```

### Railway / Render
اتبع توثيق المنصة — اضبط متغير `BASE_URL` و `PORT`.

---

## المتغيرات البيئية

| المتغير  | الوصف | القيمة الافتراضية |
|----------|-------|-------------------|
| `PORT`   | منفذ الخادم | `3000` |
| `BASE_URL` | الرابط الأساسي للموقع | `http://localhost:3000` |
| `DB_PATH` | مسار قاعدة البيانات | `./db/links.db` |

---

## الترخيص

MIT © 2024
