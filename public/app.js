/* =============================================
   DriveLink — Frontend App Logic
   Pure vanilla JS, zero dependencies (except Chart.js for dashboard)
============================================= */

// ── Config ──────────────────────────────────
const BASE_URL = window.location.origin; // e.g. https://drivelink.io

// Update the displayed prefix
document.getElementById('baseUrlDisplay').textContent = BASE_URL.replace(/^https?:\/\//, '') + '/';

// ── Storage helpers (IndexedDB via wrapper) ──
// Using localStorage for portability (switch to API calls when backend is added)
const Store = {
  _key: 'drivelink_v1',
  get() {
    try { return JSON.parse(localStorage.getItem(this._key)) || { links: [] }; }
    catch { return { links: [] }; }
  },
  save(data) { localStorage.setItem(this._key, JSON.stringify(data)); },
  getLinks() { return this.get().links; },
  addLink(link) {
    const d = this.get();
    d.links.unshift(link);
    this.save(d);
  },
  deleteLink(slug) {
    const d = this.get();
    d.links = d.links.filter(l => l.slug !== slug);
    this.save(d);
  },
  recordClick(slug, meta) {
    const d = this.get();
    const link = d.links.find(l => l.slug === slug);
    if (link) {
      if (!link.clicks) link.clicks = [];
      link.clicks.push({ ts: Date.now(), ...meta });
    }
    this.save(d);
    return link;
  }
};

// ── Slug generator ───────────────────────────
function randomSlug(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── Google Drive URL validator & transformer ─
function validateGDriveUrl(url) {
  try {
    const u = new URL(url);
    return (
      u.hostname === 'drive.google.com' ||
      u.hostname === 'docs.google.com' ||
      u.hostname === 'sheets.google.com' ||
      u.hostname === 'slides.google.com' ||
      u.hostname === 'forms.google.com'
    );
  } catch { return false; }
}

// Convert to direct view link if it's a /file/d/ link
function normalizeGDriveUrl(url) {
  try {
    const u = new URL(url);
    // /file/d/FILE_ID/view?usp=sharing  →  keep as-is (already direct)
    // /open?id=FILE_ID  →  convert to view
    if (u.pathname === '/open' && u.searchParams.has('id')) {
      const id = u.searchParams.get('id');
      return `https://drive.google.com/file/d/${id}/view?usp=sharing`;
    }
    return url;
  } catch { return url; }
}

// ── QR Code generator (pure canvas, no lib) ──
// Minimal QR via a reliable CDN-free approach — we use a public QR API
function renderQR(text, canvas) {
  const img = new Image();
  const size = 120;
  canvas.width = size;
  canvas.height = size;
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
  };
  img.onerror = () => {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000';
    ctx.font = '10px monospace';
    ctx.fillText('QR N/A', 10, 60);
  };
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
}

// ── Toast ────────────────────────────────────
let toastTimer;
function showToast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ── Copy to clipboard ────────────────────────
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('✓ تم النسخ إلى الحافظة');
  } catch {
    showToast('تعذّر النسخ تلقائياً');
  }
}

// ── Tab navigation ───────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');
    if (tab === 'dashboard') renderDashboard();
  });
});

// ── Shorten form ─────────────────────────────
const shortenBtn = document.getElementById('shortenBtn');
const longUrlInput = document.getElementById('longUrl');
const customSlugInput = document.getElementById('customSlug');
const expirySelect = document.getElementById('expiry');
const urlError = document.getElementById('urlError');
const resultDiv = document.getElementById('result');

shortenBtn.addEventListener('click', handleShorten);
longUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleShorten(); });

function handleShorten() {
  const rawUrl = longUrlInput.value.trim();
  const customSlug = customSlugInput.value.trim().replace(/\s+/g, '-').toLowerCase();
  const expiryDays = parseInt(expirySelect.value) || null;

  // Clear error
  urlError.classList.add('hidden');
  urlError.textContent = '';

  if (!rawUrl) {
    showError('الرجاء إدخال رابط Google Drive');
    return;
  }

  if (!validateGDriveUrl(rawUrl)) {
    showError('يجب أن يكون الرابط من Google Drive أو Google Docs أو Sheets أو Slides');
    return;
  }

  // Check slug collision
  const existing = Store.getLinks();
  if (customSlug && existing.some(l => l.slug === customSlug)) {
    showError('هذا الاسم المخصص مستخدم بالفعل، جرّب اسماً آخر');
    return;
  }

  const slug = customSlug || randomSlug();
  const normalizedUrl = normalizeGDriveUrl(rawUrl);

  // Build link object
  const link = {
    slug,
    longUrl: normalizedUrl,
    created: Date.now(),
    expiry: expiryDays ? Date.now() + expiryDays * 86400000 : null,
    clicks: []
  };

  Store.addLink(link);

  // Show result
  const shortUrl = `${BASE_URL}/r/${slug}`;
  document.getElementById('shortUrlDisplay').textContent = shortUrl;
  document.getElementById('openBtn').href = shortUrl;

  if (link.expiry) {
    document.getElementById('resultExpiry').textContent =
      `تنتهي في: ${new Date(link.expiry).toLocaleDateString('ar-SA')}`;
  } else {
    document.getElementById('resultExpiry').textContent = 'لا تنتهي';
  }

  resultDiv.classList.remove('hidden');
  renderQR(shortUrl, document.getElementById('qrCanvas'));

  // Copy button
  document.getElementById('copyBtn').onclick = () => copyText(shortUrl);
  document.getElementById('downloadQr').onclick = () => downloadQR(slug);

  // Reset inputs
  longUrlInput.value = '';
  customSlugInput.value = '';

  renderRecentLinks();
  showToast('✓ تم إنشاء الرابط القصير');
}

function showError(msg) {
  urlError.textContent = msg;
  urlError.classList.remove('hidden');
  longUrlInput.focus();
}

function downloadQR(slug) {
  const canvas = document.getElementById('qrCanvas');
  const a = document.createElement('a');
  a.download = `qr-${slug}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

// ── Recent links ─────────────────────────────
function renderRecentLinks() {
  const container = document.getElementById('recentLinks');
  const links = Store.getLinks().slice(0, 8);
  if (!links.length) {
    container.innerHTML = '<p style="color:var(--muted);font-size:.85rem;">لا توجد روابط بعد.</p>';
    return;
  }
  container.innerHTML = links.map(link => {
    const short = `${BASE_URL}/r/${link.slug}`;
    const expired = link.expiry && Date.now() > link.expiry;
    return `
      <div class="link-item ${expired ? 'expired' : ''}">
        <span class="link-short">${short}</span>
        <span class="link-long" title="${link.longUrl}">${link.longUrl}</span>
        <span class="link-clicks">${(link.clicks || []).length} نقرة</span>
        <button class="link-copy-btn" onclick="copyText('${short}')">نسخ</button>
      </div>
    `;
  }).join('');
}

// ── Dashboard ────────────────────────────────
let chartInstance = null;

function renderDashboard() {
  const links = Store.getLinks();
  const now = Date.now();
  const totalClicks = links.reduce((s, l) => s + (l.clicks || []).length, 0);
  const activeLinks = links.filter(l => !l.expiry || l.expiry > now).length;

  document.getElementById('totalLinks').textContent = links.length;
  document.getElementById('totalClicks').textContent = totalClicks;
  document.getElementById('activeLinks').textContent = activeLinks;

  renderTable(links);
}

function renderTable(links) {
  const now = Date.now();
  const tbody = document.getElementById('linksTableBody');
  if (!links.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:2rem;">لا توجد روابط</td></tr>';
    return;
  }

  tbody.innerHTML = links.map(link => {
    const short = `${BASE_URL}/r/${link.slug}`;
    const clickCount = (link.clicks || []).length;
    const lastClick = link.clicks?.length
      ? new Date(link.clicks[link.clicks.length - 1].ts).toLocaleDateString('ar-SA')
      : '—';
    const expired = link.expiry && now > link.expiry;
    const expiryLabel = link.expiry
      ? `<span class="badge ${expired ? 'badge-expired' : 'badge-active'}">${expired ? 'منتهية' : new Date(link.expiry).toLocaleDateString('ar-SA')}</span>`
      : '<span class="badge badge-never">دائمة</span>';

    return `
      <tr>
        <td class="td-short">${short.replace(BASE_URL + '/', '')}</td>
        <td class="td-long" title="${link.longUrl}">${link.longUrl}</td>
        <td class="td-clicks">${clickCount}</td>
        <td style="font-size:.8rem;color:var(--muted)">${lastClick}</td>
        <td>${expiryLabel}</td>
        <td>
          <div class="action-btns">
            <button class="tbl-btn" onclick="copyText('${short}')">نسخ</button>
            <button class="tbl-btn" onclick="showClickDetail('${link.slug}')">تفاصيل</button>
            <button class="tbl-btn del" onclick="deleteLink('${link.slug}')">حذف</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function deleteLink(slug) {
  if (!confirm('هل تريد حذف هذا الرابط نهائياً؟')) return;
  Store.deleteLink(slug);
  renderDashboard();
  renderRecentLinks();
  showToast('تم حذف الرابط');
}

// ── Search filter ────────────────────────────
document.getElementById('searchLinks').addEventListener('input', function () {
  const q = this.value.trim().toLowerCase();
  const links = Store.getLinks().filter(l =>
    l.slug.includes(q) || l.longUrl.toLowerCase().includes(q)
  );
  renderTable(links);
});

// ── CSV Export ───────────────────────────────
document.getElementById('exportBtn').addEventListener('click', () => {
  const links = Store.getLinks();
  const rows = [
    ['الرابط القصير', 'الرابط الأصلي', 'النقرات', 'تاريخ الإنشاء', 'تاريخ الانتهاء'],
    ...links.map(l => [
      `${BASE_URL}/r/${l.slug}`,
      l.longUrl,
      (l.clicks || []).length,
      new Date(l.created).toLocaleDateString('ar-SA'),
      l.expiry ? new Date(l.expiry).toLocaleDateString('ar-SA') : 'دائمة'
    ])
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `drivelink-export-${Date.now()}.csv`;
  a.click();
  showToast('تم تصدير الملف CSV');
});

// ── Click detail modal ───────────────────────
function showClickDetail(slug) {
  const link = Store.getLinks().find(l => l.slug === slug);
  if (!link) return;

  const modal = document.getElementById('modal');
  document.getElementById('modalTitle').textContent = `نقرات: ${BASE_URL}/r/${slug}`;
  modal.classList.remove('hidden');

  const clicks = link.clicks || [];

  // Build last-7-days chart data
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d;
  });

  const dayCounts = days.map(day => {
    const start = new Date(day); start.setHours(0, 0, 0, 0);
    const end   = new Date(day); end.setHours(23, 59, 59, 999);
    return clicks.filter(c => c.ts >= start.getTime() && c.ts <= end.getTime()).length;
  });

  const labels = days.map(d => d.toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' }));

  const canvas = document.getElementById('clickChart');
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  chartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'نقرات',
        data: dayCounts,
        backgroundColor: 'rgba(0,229,255,.25)',
        borderColor: '#00e5ff',
        borderWidth: 1.5,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#666', font: { size: 10 } }, grid: { color: '#1f1f1f' } },
        y: { ticks: { color: '#666', precision: 0, font: { size: 10 } }, grid: { color: '#1f1f1f' } }
      }
    }
  });

  // Click list
  const listEl = document.getElementById('clickList');
  if (!clicks.length) {
    listEl.innerHTML = '<p style="color:var(--muted);font-size:.85rem;text-align:center;padding:.75rem">لا توجد نقرات بعد</p>';
    return;
  }
  listEl.innerHTML = [...clicks].reverse().slice(0, 50).map(c => `
    <div class="click-entry">
      <span class="click-ip">${c.ip || 'مجهول'}</span>
      <span class="click-ua">${c.ua || '—'}</span>
      <span class="click-time">${new Date(c.ts).toLocaleString('ar-SA')}</span>
    </div>
  `).join('');
}

document.getElementById('modalClose').onclick = closeModal;
document.querySelector('.modal-backdrop').onclick = closeModal;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
}

// ── Redirect handler (SPA-style) ─────────────
// When path matches /r/:slug — handle redirect and record click
(function handleRedirect() {
  const m = window.location.pathname.match(/^\/r\/([a-zA-Z0-9_-]+)$/);
  if (!m) return;
  const slug = m[1];

  // Record click
  Store.recordClick(slug, {
    ua: navigator.userAgent,
    ip: '—' // IP must be captured server-side; placeholder here
  });

  const link = Store.getLinks().find(l => l.slug === slug);
  if (!link) {
    document.body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:monospace;color:#666;">
        <p style="font-size:2rem;margin-bottom:.5rem">404</p>
        <p>الرابط غير موجود أو انتهت صلاحيته</p>
        <a href="/" style="margin-top:1rem;color:#00e5ff">→ العودة للرئيسية</a>
      </div>`;
    return;
  }

  if (link.expiry && Date.now() > link.expiry) {
    document.body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:monospace;color:#666;">
        <p style="font-size:2rem;margin-bottom:.5rem">انتهت الصلاحية</p>
        <p>هذا الرابط لم يعد نشطاً</p>
        <a href="/" style="margin-top:1rem;color:#00e5ff">→ العودة للرئيسية</a>
      </div>`;
    return;
  }

  window.location.replace(link.longUrl);
})();

// ── Init ─────────────────────────────────────
renderRecentLinks();
