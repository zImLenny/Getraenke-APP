const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

// url: "libsql://…" (Turso), "file:pfad.db" (lokal) oder ":memory:" (Tests).
async function openDatabase(url, authToken) {
  if (url.startsWith('file:')) fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
  const client = createClient({ url, authToken });

  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name  TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drinks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      price_cents INTEGER NOT NULL DEFAULT 0,
      active      INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Ein Event = ein Abend. Es läuft höchstens ein Event (ended_at IS NULL).
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at   TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_event ON events((ended_at IS NULL)) WHERE ended_at IS NULL;

    -- Zahlungsdaten des Admins (payeeName, iban, paypal).
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Jede Zeile = ein Getränk. Der Preis wird beim Buchen gespeichert,
    -- damit spätere Preisänderungen alte Buchungen nicht verändern.
    -- Admin-Minus löscht nicht, sondern markiert die Zeile (deleted_at).
    CREATE TABLE IF NOT EXISTS consumptions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      drink_id    INTEGER NOT NULL REFERENCES drinks(id),
      price_cents INTEGER NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      deleted_at  TEXT,
      deleted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      event_id    INTEGER REFERENCES events(id)
    );

    -- Admin hakt ab: Person hat für dieses Event bezahlt.
    CREATE TABLE IF NOT EXISTS payments (
      event_id INTEGER NOT NULL REFERENCES events(id),
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      paid_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (event_id, user_id)
    );
  `);

  // Alte Datenbanken ohne Events: Spalte nachrüsten, alte Buchungen in ein beendetes Event legen.
  const cols = (await client.execute('PRAGMA table_info(consumptions)')).rows;
  if (!cols.some((c) => c.name === 'event_id')) {
    await client.execute('ALTER TABLE consumptions ADD COLUMN event_id INTEGER REFERENCES events(id)');
    if ((await client.execute('SELECT 1 FROM consumptions LIMIT 1')).rows.length) {
      const ev = await client.execute(`INSERT INTO events (name, ended_at) VALUES ('Frühere Buchungen', datetime('now'))`);
      await client.execute({ sql: 'UPDATE consumptions SET event_id = ?', args: [ev.lastInsertRowid] });
    }
  }
  await client.executeMultiple(`
    DROP INDEX IF EXISTS idx_cons_user_drink;
    CREATE INDEX IF NOT EXISTS idx_cons_event ON consumptions(event_id, user_id, drink_id) WHERE deleted_at IS NULL;
  `);

  // Gleiche Methoden-Namen wie vorher (get/all/run), nur async.
  const exec = (sql, args = []) => client.execute({ sql, args });
  return {
    get: async (sql, ...args) => (await exec(sql, args)).rows[0],
    all: async (sql, ...args) => (await exec(sql, args)).rows,
    run: async (sql, ...args) => {
      const r = await exec(sql, args);
      return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid) };
    },
    // Mehrere Schreib-Befehle als eine Transaktion.
    batch: (stmts) => client.batch(stmts.map(([sql, ...args]) => ({ sql, args })), 'write'),
  };
}

module.exports = { openDatabase };
