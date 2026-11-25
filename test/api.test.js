const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');

let server;
let base;

before(async () => {
  const app = await createApp({ dbUrl: ':memory:', adminUsername: 'admin', adminPassword: 'geheim123', registrationCode: 'party' });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => server.close());

// Kleiner Client, der den Sitzungs-Cookie behält.
function client() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('kompletter Ablauf: Admin legt Getränk an, Gast bucht, Admin korrigiert', async () => {
  const admin = client();
  const guest = client();

  assert.equal((await admin('/login', { method: 'POST', body: { username: 'admin', password: 'falsch' } })).status, 401);
  assert.equal((await admin('/login', { method: 'POST', body: { username: 'admin', password: 'geheim123' } })).status, 200);
  assert.equal((await admin('/me')).data.user.isAdmin, true);

  const bier = await admin('/admin/drinks', { method: 'POST', body: { name: 'Bier', price: '3,50' } });
  assert.equal(bier.status, 201);
  const bierId = bier.data.id;

  // Ohne Event kann niemand buchen
  assert.equal((await admin('/admin/consumptions', { method: 'POST', body: { userId: 1, drinkId: bierId } })).status, 409);
  assert.equal((await admin('/admin/events', { method: 'POST', body: { name: 'Testabend' } })).status, 201);
  assert.equal((await admin('/admin/events', { method: 'POST', body: { name: 'Doppelt' } })).status, 409);

  // Registrierung nur mit richtigem Code
  assert.equal((await guest('/register', { method: 'POST', body: { username: 'max', password: 'abcdef', code: 'nope' } })).status, 403);
  assert.equal((await guest('/register', { method: 'POST', body: { username: 'max', displayName: 'Max', password: 'abcdef', code: 'party' } })).status, 201);
  const me = (await guest('/me')).data.user;
  assert.equal(me.isAdmin, false);

  // Gast darf Plus …
  let r = await guest('/consumptions', { method: 'POST', body: { drinkId: bierId } });
  assert.equal(r.status, 201);
  // … aber kein Doppel-Tipp direkt hintereinander
  assert.equal((await guest('/consumptions', { method: 'POST', body: { drinkId: bierId } })).status, 429);
  await sleep(900);
  r = await guest('/consumptions', { method: 'POST', body: { drinkId: bierId } });
  assert.equal(r.data.totalCount, 2);
  assert.equal(r.data.totalCents, 700);

  // … aber kein Minus und keine Admin-Funktionen
  assert.equal((await guest('/admin/consumptions/undo', { method: 'POST', body: { userId: me.id, drinkId: bierId } })).status, 403);
  assert.equal((await guest('/admin/overview')).status, 403);

  // Preisänderung wirkt nur auf neue Buchungen
  await admin(`/admin/drinks/${bierId}`, { method: 'PUT', body: { price: '4' } });
  await sleep(900);
  r = await guest('/consumptions', { method: 'POST', body: { drinkId: bierId } });
  assert.equal(r.data.totalCents, 1100);

  // Admin-Minus
  assert.equal((await admin('/admin/consumptions/undo', { method: 'POST', body: { userId: me.id, drinkId: bierId } })).status, 200);
  const ov = (await admin('/admin/overview')).data;
  const cell = ov.cells.find((c) => c.userId === me.id && c.drinkId === bierId);
  assert.equal(cell.count, 2);
  assert.equal(cell.totalCents, 700);

  // Protokoll zeigt die entfernte Buchung
  const log = (await admin('/admin/log')).data.log;
  assert.equal(log.filter((l) => l.deletedAt).length, 1);

  // Getränk mit Buchungen lässt sich nicht löschen
  assert.equal((await admin(`/admin/drinks/${bierId}`, { method: 'DELETE' })).status, 409);

  // Deaktiviertes Getränk kann der Gast nicht buchen
  await admin(`/admin/drinks/${bierId}`, { method: 'PUT', body: { active: false } });
  assert.equal((await guest('/drinks')).data.drinks.length, 0);
  assert.equal((await guest('/consumptions', { method: 'POST', body: { drinkId: bierId } })).status, 404);

  // CSV-Export
  const csv = await admin('/admin/export.csv');
  assert.match(csv.data, /"Max";"max";"Bier";2;7,00/);
});

test('ohne Anmeldung kein Zugriff', async () => {
  const anon = client();
  assert.equal((await anon('/drinks')).status, 401);
  assert.equal((await anon('/consumptions', { method: 'POST', body: { drinkId: 1 } })).status, 401);
  assert.equal((await anon('/admin/overview')).status, 401);
});

test('Benutzername ist eindeutig (ohne Groß/Klein)', async () => {
  const c = client();
  assert.equal((await c('/register', { method: 'POST', body: { username: 'Anna', password: 'abcdef', code: 'party' } })).status, 201);
  assert.equal((await client()('/register', { method: 'POST', body: { username: 'anna', password: 'abcdef', code: 'party' } })).status, 409);
});

test('Login-Sperre nach 10 Fehlversuchen, Passwort-Reset beendet Sitzungen', async () => {
  const g = client();
  await g('/register', { method: 'POST', body: { username: 'lisa', password: 'abcdef', code: 'party' } });
  const id = (await g('/me')).data.user.id;
  const admin = client();
  await admin('/login', { method: 'POST', body: { username: 'admin', password: 'geheim123' } });
  assert.equal((await admin(`/admin/users/${id}`, { method: 'PUT', body: { password: 'neues-pw' } })).status, 200);
  assert.equal((await g('/me')).data.user, null);

  const bad = client();
  for (let i = 0; i < 10; i++) {
    assert.equal((await bad('/login', { method: 'POST', body: { username: 'lisa', password: 'falsch' } })).status, 401);
  }
  assert.equal((await bad('/login', { method: 'POST', body: { username: 'lisa', password: 'neues-pw' } })).status, 429);
});

test('leerer Preis wird abgelehnt, CSV entschärft Formeln', async () => {
  const admin = client();
  await admin('/login', { method: 'POST', body: { username: 'admin', password: 'geheim123' } });
  const id = (await admin('/admin/drinks', { method: 'POST', body: { name: 'Saft', price: '2' } })).data.id;
  assert.equal((await admin(`/admin/drinks/${id}`, { method: 'PUT', body: { name: 'Saft', price: '' } })).status, 400);

  const g = client();
  await g('/register', { method: 'POST', body: { username: 'evil', displayName: '=1+1', password: 'abcdef', code: 'party' } });
  await g('/consumptions', { method: 'POST', body: { drinkId: id } });
  assert.match((await admin('/admin/export.csv')).data, /"'=1\+1";"evil";"Saft";1;2,00/);
});

test('Admin löscht Person samt Buchungen', async () => {
  const admin = client();
  await admin('/login', { method: 'POST', body: { username: 'admin', password: 'geheim123' } });
  const drinkId = (await admin('/admin/drinks', { method: 'POST', body: { name: 'Wasser', price: '1' } })).data.id;
  const g = client();
  await g('/register', { method: 'POST', body: { username: 'tom', password: 'abcdef', code: 'party' } });
  const id = (await g('/me')).data.user.id;
  await g('/consumptions', { method: 'POST', body: { drinkId } });
  assert.equal((await admin(`/admin/users/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await g('/me')).data.user, null);
  assert.ok(!(await admin('/admin/overview')).data.cells.some((c) => c.userId === id));
});

test('Event beenden: Liste ist fest, Gast sieht Abrechnung mit QR-Code und PayPal', async () => {
  const admin = client();
  await admin('/login', { method: 'POST', body: { username: 'admin', password: 'geheim123' } });
  const drinkId = (await admin('/admin/drinks', { method: 'POST', body: { name: 'Cola', price: '2,50' } })).data.id;
  const g = client();
  await g('/register', { method: 'POST', body: { username: 'paula', displayName: 'Paula', password: 'abcdef', code: 'party' } });
  await g('/consumptions', { method: 'POST', body: { drinkId } });
  assert.equal((await g('/me/summary')).data.payment, null);

  const end = (body) => admin('/admin/events/end', { method: 'POST', body });
  assert.equal((await end({})).status, 400);
  assert.equal((await end({ payeeName: 'Lenny', iban: 'DE89370400440532013001' })).status, 400); // Prüfziffer falsch
  assert.equal((await end({ iban: 'DE89 3704 0044 0532 0130 00' })).status, 400); // Name fehlt
  assert.equal((await end({ paypal: 'javascript:alert(1)' })).status, 400);
  assert.equal((await end({ payeeName: 'Lenny', iban: 'de89 3704 0044 0532 0130 00', paypal: 'https://paypal.me/lenny' })).status, 200);
  assert.equal((await end({ paypal: 'lenny' })).status, 409); // schon beendet

  const s = (await g('/me/summary')).data;
  assert.ok(s.event.endedAt);
  assert.equal(s.totalCents, 250);
  assert.equal(s.perDrink[0].name, 'Cola');
  assert.equal(s.payment.iban, 'DE89370400440532013000');
  assert.equal(s.payment.paypalUrl, 'https://paypal.me/lenny/2.50EUR');
  assert.match(s.payment.qr, /^data:image\/png;base64,/);
  assert.match(s.payment.reference, /Paula/);

  // Liste ist fest
  await sleep(900); // Doppel-Tipp-Schutz abwarten
  assert.equal((await g('/consumptions', { method: 'POST', body: { drinkId } })).status, 409);
  assert.equal((await admin('/admin/consumptions', { method: 'POST', body: { userId: 1, drinkId } })).status, 409);
  assert.equal((await admin('/admin/settings')).data.paypal, 'lenny');

  // Neues Event startet bei null
  assert.equal((await admin('/admin/events', { method: 'POST', body: { name: 'Abend 2' } })).status, 201);
  const s2 = (await g('/me/summary')).data;
  assert.equal(s2.event.name, 'Abend 2');
  assert.equal(s2.totalCents, 0);
});
