/**
 * DriveLink — Node.js Backend
 * Express + SQLite (better-sqlite3)
 * 
 * Routes:
 *   POST   /api/links          — create short link
 *   GET    /api/links          — list all links
 *   GET    /api/links/:slug    — get single link + clicks
 *   DELETE /api/links/:slug    — delete link
 *   GET    /api/stats          — global stats
 *   GET    /r/:slug            — redirect + record click
 */

'use strict';

const express    = require('express');
const Database   = require('better-sqlite3');
const path       = require('path');
const crypto     = require('crypto');
const rateLimit  = require('express-rate-limit');

// ── Config ───────────────────────────────────
const PORT    = process.env.PORT    || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'db', 'links.db');
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ── Database setup ───────────────────────────
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS links (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT    NOT NULL UNIQUE,
    long_url   TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    expires_at INTEGER,
    is_active  INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS clicks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT    NOT NULL,
    clicked_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    ip_address TEXT,
    user_agent TEXT,
    referer    TEXT,
    country    TEXT,
    FOREIGN KEY (slug) REFERENCES links(slug) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_clicks_slug ON clicks(slug);
  CREATE INDEX IF NOT EXISTS idx_links_slug  ON links(slug);
`);

// Prepared statements
const stmts = {
  insertLink: db.prepare(
    'INSERT INTO links (slug, long_url, expires_at) VALUES (?, ?, ?)'
  ),
  getLink: db.prepare(
    'SELECT * FROM links WHERE slug = ? AND is_active = 1'
  ),
  listLinks: db.prepare(
    `SELECT l.*,
            COUNT(c.id)  AS click_count,
            MAX(c.clicked_at) AS last_click
     FROM links l
     LEFT JOIN clicks c ON l.slug = c.slug
     GROUP BY l.slug
     ORDER BY l.created_at DESC`
  ),
  deleteLink: db.prepare(
    'UPDATE links SET is_active = 0 WHERE slug = ?'
  ),
  insertClick: db.prepare(
    'INSERT INTO clicks (slug, ip_address, user_agent, referer) VALUES (?, ?, ?, ?)'
  ),
  getClicks: db.prepare(
    'SELECT * FROM clicks WHERE slug = ? ORDER BY clicked_at DESC LIMIT 200'
  ),
  globalStats: db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM links WHERE is_active = 1)                            AS total_links,
       (SELECT COUNT(*) FROM clicks)                                               AS total_clicks,
       (SELECT COUNT(*) FROM links WHERE is_active = 1
         AND (expires_at IS NULL OR expires_at > unixepoch()*1000))               AS active_links
    `
  )
};

// ── Express setup ────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate limiter for shortening endpoint
const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: { error: 'تجاوزت الحد المسموح به، حاول لاحقاً' }
});

// ── Helpers ──────────────────────────────────
function randomSlug(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.randomBytes(len))
    .map(b => chars[b % chars.length])
    .join('');
}

function isValidGDriveUrl(url) {
  try {
    const u = new URL(url);
    const allowed = [
      'drive.google.com',
      'docs.google.com',
      'sheets.google.com',
      'slides.google.com',
      'forms.google.com'
    ];
    return allowed.includes(u.hostname);
  } catch { return false; }
}

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    '—'
  );
}

// ── API Routes ───────────────────────────────

// POST /api/links — create new short link
app.post('/api/links', createLimiter, (req, res) => {
  const { longUrl, customSlug, expiryDays } = req.body;

  if (!longUrl || typeof longUrl !== 'string') {
    return res.status(400).json({ error: 'longUrl مطلوب' });
  }

  const trimmed = longUrl.trim();

  if (!isValidGDriveUrl(trimmed)) {
    return res.status(400).json({ error: 'يجب أن يكون الرابط من Google Drive أو Google Docs/Sheets/Slides' });
  }

  // Slug validation
  let slug = customSlug
    ? String(customSlug).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 60)
    : randomSlug();

  if (!slug || slug.length < 2) slug = randomSlug();

  // Check uniqueness
  const existing = stmts.getLink.get(slug);
  if (existing) {
    return res.status(409).json({ error: 'هذا الاسم المخصص مستخدم بالفعل' });
  }

  const expiresAt = expiryDays
    ? Date.now() + parseInt(expiryDays) * 24 * 3600 * 1000
    : null;

  try {
    stmts.insertLink.run(slug, trimmed, expiresAt);
    return res.status(201).json({
      slug,
      shortUrl: `${BASE_URL}/r/${slug}`,
      longUrl: trimmed,
      expiresAt: expiresAt || null
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'هذا الاسم المخصص مستخدم بالفعل' });
    }
    console.error(err);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// GET /api/links — list all links with click counts
app.get('/api/links', (req, res) => {
  const links = stmts.listLinks.all();
  res.json(links.map(l => ({
    ...l,
    shortUrl: `${BASE_URL}/r/${l.slug}`
  })));
});

// GET /api/links/:slug — single link details + click history
app.get('/api/links/:slug', (req, res) => {
  const { slug } = req.params;
  const link = stmts.getLink.get(slug);
  if (!link) return res.status(404).json({ error: 'رابط غير موجود' });

  const clicks = stmts.getClicks.all(slug);
  res.json({ ...link, shortUrl: `${BASE_URL}/r/${slug}`, clicks });
});

// DELETE /api/links/:slug — soft delete
app.delete('/api/links/:slug', (req, res) => {
  const { slug } = req.params;
  const info = stmts.deleteLink.run(slug);
  if (info.changes === 0) return res.status(404).json({ error: 'رابط غير موجود' });
  res.json({ success: true });
});

// GET /api/stats — global statistics
app.get('/api/stats', (req, res) => {
  res.json(stmts.globalStats.get());
});

// ── Redirect Route ───────────────────────────
app.get('/r/:slug', (req, res) => {
  const { slug } = req.params;
  const link = stmts.getLink.get(slug);

  if (!link) {
    return res.status(404).redirect(`/?error=not-found&slug=${slug}`);
  }

  if (link.expires_at && Date.now() > link.expires_at) {
    return res.status(410).redirect(`/?error=expired&slug=${slug}`);
  }

  // Record click asynchronously (don't slow down redirect)
  setImmediate(() => {
    stmts.insertClick.run(
      slug,
      getClientIp(req),
      req.headers['user-agent'] || null,
      req.headers['referer']    || null
    );
  });

  res.redirect(302, link.long_url);
});

// ── SPA fallback ─────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Start server ─────────────────────────────
app.listen(PORT, () => {
  console.log(`\n⬡  DriveLink server running`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Base URL: ${BASE_URL}\n`);
});

module.exports = app;
