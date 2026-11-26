const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClient } = require('@libsql/client');
const { openDatabase } = require('../src/db');

test('alte Datenbank ohne Events: Buchungen landen in „Frühere Buchungen“', async () => {
  const url = 'file:' + path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'getraenke-')), 'alt.db');
  const old = createClient({ url });
  await old.executeMultiple(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE drinks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price_cents INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE consumptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, drink_id INTEGER NOT NULL,
      price_cents INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), created_by INTEGER,
      deleted_at TEXT, deleted_by INTEGER);
    CREATE INDEX idx_cons_user_drink ON consumptions(user_id, drink_id) WHERE deleted_at IS NULL;
    INSERT INTO users (username, display_name, password_hash) VALUES ('max', 'Max', 'x');
    INSERT INTO drinks (name, price_cents) VALUES ('Bier', 350);
    INSERT INTO consumptions (user_id, drink_id, price_cents) VALUES (1, 1, 350);
    -- payments ohne paid_cents (Version vom 26.11.2026)
    CREATE TABLE payments (event_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      paid_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (event_id, user_id));
    INSERT INTO payments (event_id, user_id) VALUES (1, 1);
  `);
  old.close();

  await openDatabase(url);
  const db = await openDatabase(url); // zweiter Start darf nichts doppelt anlegen
  const events = await db.all('SELECT name, ended_at AS endedAt FROM events');
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'Frühere Buchungen');
  assert.ok(events[0].endedAt);
  assert.equal((await db.get('SELECT event_id AS e FROM consumptions')).e, 1);
  // alter Haken gilt für die damalige Summe
  assert.equal((await db.get('SELECT paid_cents AS c FROM payments')).c, 350);
});
