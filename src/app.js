const path = require('path');
const express = require('express');
const { openDatabase } = require('./db');
const { hashPassword, verifyPassword, createAuth, requireUser, requireAdmin } = require('./auth');

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const DOUBLE_TAP_MS = 800;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function str(value, field, { min = 1, max = 100 } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length < min || s.length > max) throw new HttpError(400, `${field}: ${min}–${max} Zeichen.`);
  return s;
}

function priceToCents(value) {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10000) throw new HttpError(400, 'Preis ungültig.');
  return Math.round(n * 100);
}

function intId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Ungültige ID.');
  return n;
}

// Einfache Bremse gegen Passwort-Raten: max. 10 Fehlversuche pro 15 Minuten.
function createLoginLimiter() {
  const fails = new Map();
  const WINDOW = 15 * 60 * 1000;
  const MAX = 10;
  return {
    blocked(key) {
      const e = fails.get(key);
      if (!e || Date.now() - e.first > WINDOW) return false;
      return e.count >= MAX;
    },
    fail(key) {
      const e = fails.get(key);
      if (!e || Date.now() - e.first > WINDOW) fails.set(key, { first: Date.now(), count: 1 });
      else e.count++;
    },
    reset(key) {
      fails.delete(key);
    },
  };
}

function createApp(config = {}) {
  const cfg = {
    dbFile: config.dbFile || path.join(__dirname, '..', 'data', 'getraenke.db'),
    registrationCode: config.registrationCode || '',
    secureCookies: !!config.secureCookies,
    adminUsername: config.adminUsername || '',
    adminPassword: config.adminPassword || '',
  };

  const db = openDatabase(cfg.dbFile);
  const auth = createAuth(db, cfg);
  const limiter = createLoginLimiter();
  const lastTap = new Map();

  // Start-Admin aus Umgebungsvariablen anlegen, falls noch kein Admin existiert.
  const adminCount = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n;
  if (adminCount === 0 && cfg.adminUsername && cfg.adminPassword) {
    db.prepare(`INSERT INTO users (username, display_name, password_hash, is_admin) VALUES (?, ?, ?, 1)
                ON CONFLICT(username) DO UPDATE SET is_admin = 1, password_hash = excluded.password_hash`)
      .run(cfg.adminUsername, cfg.adminUsername, hashPassword(cfg.adminPassword));
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '20kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(auth.middleware);

  const api = express.Router();

  // ---------- Konto ----------

  api.get('/config', (_req, res) => {
    res.json({ registrationCodeRequired: !!cfg.registrationCode });
  });

  api.post('/register', (req, res) => {
    const username = str(req.body.username, 'Benutzername', { min: 3, max: 32 });
    if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Benutzername: nur Buchstaben, Zahlen, . _ -');
    const displayName = str(req.body.displayName || username, 'Anzeigename', { max: 40 });
    const password = str(req.body.password, 'Passwort', { min: 6, max: 200 });
    if (cfg.registrationCode && req.body.code !== cfg.registrationCode) {
      throw new HttpError(403, 'Einladungscode falsch.');
    }
    // Ohne Start-Admin wird die erste registrierte Person Admin.
    const noAdmin = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n === 0;
    let info;
    try {
      info = db.prepare('INSERT INTO users (username, display_name, password_hash, is_admin) VALUES (?, ?, ?, ?)')
        .run(username, displayName, hashPassword(password), noAdmin ? 1 : 0);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Benutzername ist schon vergeben.');
      throw e;
    }
    auth.login(res, info.lastInsertRowid);
    res.status(201).json({ ok: true });
  });

  api.post('/login', (req, res) => {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const key = `${req.ip}|${username.toLowerCase()}`;
    if (limiter.blocked(key)) throw new HttpError(429, 'Zu viele Versuche. Bitte 15 Minuten warten.');
    const user = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      limiter.fail(key);
      throw new HttpError(401, 'Benutzername oder Passwort falsch.');
    }
    limiter.reset(key);
    auth.login(res, user.id);
    res.json({ ok: true });
  });

  api.post('/logout', (req, res) => {
    auth.logout(req, res);
    res.json({ ok: true });
  });

  api.get('/me', (req, res) => {
    res.json({ user: req.user });
  });

  // ---------- Gäste ----------

  api.get('/drinks', requireUser, (_req, res) => {
    const drinks = db.prepare(`SELECT id, name, price_cents AS priceCents FROM drinks
                               WHERE active = 1 ORDER BY sort_order, name`).all();
    res.json({ drinks });
  });

  function userSummary(userId) {
    const rows = db.prepare(`
      SELECT drink_id AS drinkId, COUNT(*) AS count, SUM(price_cents) AS totalCents
      FROM consumptions WHERE user_id = ? AND deleted_at IS NULL GROUP BY drink_id`).all(userId);
    const totalCents = rows.reduce((s, r) => s + r.totalCents, 0);
    const totalCount = rows.reduce((s, r) => s + r.count, 0);
    return { perDrink: rows, totalCents, totalCount };
  }

  api.get('/me/summary', requireUser, (req, res) => {
    res.json(userSummary(req.user.id));
  });

  // Nur Plus. Minus darf nur der Admin.
  api.post('/consumptions', requireUser, (req, res) => {
    const drinkId = intId(req.body.drinkId);
    const drink = db.prepare('SELECT id, price_cents FROM drinks WHERE id = ? AND active = 1').get(drinkId);
    if (!drink) throw new HttpError(404, 'Getränk nicht gefunden.');
    // Schutz gegen versehentlichen Doppel-Tipp.
    const tapKey = `${req.user.id}:${drinkId}`;
    const now = Date.now();
    if (now - (lastTap.get(tapKey) || 0) < DOUBLE_TAP_MS) throw new HttpError(429, 'Zu schnell – bitte kurz warten.');
    lastTap.set(tapKey, now);
    db.prepare('INSERT INTO consumptions (user_id, drink_id, price_cents, created_by) VALUES (?, ?, ?, ?)')
      .run(req.user.id, drinkId, drink.price_cents, req.user.id);
    res.status(201).json(userSummary(req.user.id));
  });

  // ---------- Admin ----------

  const admin = express.Router();
  admin.use(requireAdmin);

  admin.get('/overview', (_req, res) => {
    const users = db.prepare(`SELECT id, username, display_name AS displayName, is_admin AS isAdmin
                              FROM users ORDER BY display_name COLLATE NOCASE`).all();
    const drinks = db.prepare(`SELECT id, name, price_cents AS priceCents, active FROM drinks
                               ORDER BY sort_order, name`).all();
    const cells = db.prepare(`
      SELECT user_id AS userId, drink_id AS drinkId, COUNT(*) AS count, SUM(price_cents) AS totalCents
      FROM consumptions WHERE deleted_at IS NULL GROUP BY user_id, drink_id`).all();
    res.json({ users, drinks, cells });
  });

  admin.post('/consumptions', (req, res) => {
    const userId = intId(req.body.userId);
    const drinkId = intId(req.body.drinkId);
    const drink = db.prepare('SELECT price_cents FROM drinks WHERE id = ?').get(drinkId);
    if (!drink) throw new HttpError(404, 'Getränk nicht gefunden.');
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw new HttpError(404, 'Person nicht gefunden.');
    db.prepare('INSERT INTO consumptions (user_id, drink_id, price_cents, created_by) VALUES (?, ?, ?, ?)')
      .run(userId, drinkId, drink.price_cents, req.user.id);
    res.status(201).json({ ok: true });
  });

  // Minus: markiert die letzte Buchung dieser Person für dieses Getränk als gelöscht.
  admin.post('/consumptions/undo', (req, res) => {
    const userId = intId(req.body.userId);
    const drinkId = intId(req.body.drinkId);
    const info = db.prepare(`
      UPDATE consumptions SET deleted_at = datetime('now'), deleted_by = ?
      WHERE id = (SELECT id FROM consumptions WHERE user_id = ? AND drink_id = ? AND deleted_at IS NULL
                  ORDER BY id DESC LIMIT 1)`).run(req.user.id, userId, drinkId);
    if (info.changes === 0) throw new HttpError(404, 'Keine Buchung vorhanden.');
    res.json({ ok: true });
  });

  admin.get('/log', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = db.prepare(`
      SELECT c.id, c.created_at AS createdAt, c.deleted_at AS deletedAt, c.price_cents AS priceCents,
             u.display_name AS userName, d.name AS drinkName,
             cb.display_name AS createdByName, db2.display_name AS deletedByName
      FROM consumptions c
      JOIN users u ON u.id = c.user_id
      JOIN drinks d ON d.id = c.drink_id
      LEFT JOIN users cb ON cb.id = c.created_by
      LEFT JOIN users db2 ON db2.id = c.deleted_by
      ORDER BY c.id DESC LIMIT ?`).all(limit);
    res.json({ log: rows });
  });

  admin.get('/export.csv', (_req, res) => {
    const rows = db.prepare(`
      SELECT u.display_name AS person, u.username, d.name AS drink, COUNT(*) AS count, SUM(c.price_cents) AS cents
      FROM consumptions c JOIN users u ON u.id = c.user_id JOIN drinks d ON d.id = c.drink_id
      WHERE c.deleted_at IS NULL
      GROUP BY c.user_id, c.drink_id ORDER BY u.display_name COLLATE NOCASE, d.sort_order, d.name`).all();
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = ['Person;Benutzername;Getränk;Anzahl;Betrag (EUR)'];
    for (const r of rows) {
      lines.push([esc(r.person), esc(r.username), esc(r.drink), r.count, (r.cents / 100).toFixed(2).replace('.', ',')].join(';'));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="getraenke.csv"');
    res.send('﻿' + lines.join('\r\n'));
  });

  // Getränke verwalten
  admin.post('/drinks', (req, res) => {
    const name = str(req.body.name, 'Name', { max: 50 });
    const priceCents = priceToCents(req.body.price ?? 0);
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM drinks').get().m;
    const info = db.prepare('INSERT INTO drinks (name, price_cents, sort_order) VALUES (?, ?, ?)')
      .run(name, priceCents, maxSort + 1);
    res.status(201).json({ id: info.lastInsertRowid });
  });

  admin.put('/drinks/:id', (req, res) => {
    const id = intId(req.params.id);
    const drink = db.prepare('SELECT * FROM drinks WHERE id = ?').get(id);
    if (!drink) throw new HttpError(404, 'Getränk nicht gefunden.');
    const name = req.body.name !== undefined ? str(req.body.name, 'Name', { max: 50 }) : drink.name;
    const price = req.body.price !== undefined ? priceToCents(req.body.price) : drink.price_cents;
    const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : drink.active;
    const sort = req.body.sortOrder !== undefined ? Number(req.body.sortOrder) || 0 : drink.sort_order;
    db.prepare('UPDATE drinks SET name = ?, price_cents = ?, active = ?, sort_order = ? WHERE id = ?')
      .run(name, price, active, sort, id);
    res.json({ ok: true });
  });

  admin.delete('/drinks/:id', (req, res) => {
    const id = intId(req.params.id);
    const used = db.prepare('SELECT COUNT(*) AS n FROM consumptions WHERE drink_id = ?').get(id).n;
    if (used > 0) throw new HttpError(409, 'Getränk hat Buchungen. Bitte stattdessen deaktivieren.');
    db.prepare('DELETE FROM drinks WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // Personen verwalten
  admin.put('/users/:id', (req, res) => {
    const id = intId(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw new HttpError(404, 'Person nicht gefunden.');
    if (req.body.isAdmin !== undefined) {
      if (id === req.user.id && !req.body.isAdmin) throw new HttpError(400, 'Du kannst dir die Admin-Rechte nicht selbst nehmen.');
      db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(req.body.isAdmin ? 1 : 0, id);
    }
    if (req.body.displayName !== undefined) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(str(req.body.displayName, 'Anzeigename', { max: 40 }), id);
    }
    if (req.body.password !== undefined) {
      const pw = str(req.body.password, 'Passwort', { min: 6, max: 200 });
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    res.json({ ok: true });
  });

  admin.delete('/users/:id', (req, res) => {
    const id = intId(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'Du kannst dich nicht selbst löschen.');
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  api.use('/admin', admin);
  api.use((_req, _res, next) => next(new HttpError(404, 'Nicht gefunden.')));
  app.use('/api', api);

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  // Fehlerbehandlung: HttpError → Statuscode, alles andere → 500
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungültige Anfrage.' });
    console.error(err);
    res.status(500).json({ error: 'Serverfehler.' });
  });

  app.locals.db = db;
  return app;
}

module.exports = { createApp };
