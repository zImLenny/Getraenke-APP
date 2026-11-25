const crypto = require('crypto');

const SESSION_DAYS = 30;
const COOKIE = 'sid';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createAuth(db, { secureCookies }) {
  const stmts = {
    insert: db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`),
    find: db.prepare(`
      SELECT u.id, u.username, u.display_name AS displayName, u.is_admin AS isAdmin
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > datetime('now')`),
    remove: db.prepare(`DELETE FROM sessions WHERE token = ?`),
    purge: db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`),
  };
  stmts.purge.run();

  function setCookie(res, token, maxAgeSec) {
    const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
    if (secureCookies) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  return {
    login(res, userId) {
      const token = crypto.randomBytes(32).toString('hex');
      stmts.insert.run(token, userId, `+${SESSION_DAYS} days`);
      setCookie(res, token, SESSION_DAYS * 86400);
    },
    logout(req, res) {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) stmts.remove.run(token);
      setCookie(res, '', 0);
    },
    // Hängt req.user an, falls eine gültige Sitzung existiert.
    middleware(req, _res, next) {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      const user = token ? stmts.find.get(token) : null;
      req.user = user ? { ...user, isAdmin: !!user.isAdmin } : null;
      next();
    },
  };
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Bitte anmelden.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Bitte anmelden.' });
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Nur für Admins.' });
  next();
}

module.exports = { hashPassword, verifyPassword, createAuth, requireUser, requireAdmin };
