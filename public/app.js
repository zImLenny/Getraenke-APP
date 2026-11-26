'use strict';

// ---------- Hilfsfunktionen ----------

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');
const $eventbar = document.getElementById('eventbar');
const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const fmt = (cents) => euro.format((cents || 0) / 100);
const time = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });

// Baut DOM-Elemente ohne innerHTML (kein XSS durch Benutzernamen).
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer;
function toast(msg, isError = false) {
  $toast.textContent = msg;
  $toast.className = 'show' + (isError ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.className = ''), isError ? 3500 : 1600);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    state.user = null;
    route();
  }
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

function vibrate() {
  if (navigator.vibrate) navigator.vibrate(30);
}

// ---------- Zustand und Routing ----------

const state = { user: null, event: null, config: {}, pollTimer: null };

// Name des Events steht oben auf jeder Seite.
function setEvent(ev) {
  state.event = ev;
  $eventbar.hidden = !state.user || !ev;
  if (ev) $eventbar.replaceChildren('Event: ', h('b', {}, ev.name), ' · ',
    h('span', { class: ev.endedAt ? '' : 'live' }, ev.endedAt ? 'beendet' : 'läuft'));
}

function setNav() {
  setEvent(state.event);
  $nav.replaceChildren();
  if (!state.user) return;
  const here = location.hash || '#/';
  if (state.user.isAdmin) {
    if (here.startsWith('#/admin')) $nav.append(h('a', { class: 'btn sm ghost', href: '#/' }, 'Meine Getränke'));
    else $nav.append(h('a', { class: 'btn sm', href: '#/admin' }, 'Admin'));
  }
  $nav.append(h('button', { class: 'btn sm ghost', onclick: logout }, 'Abmelden'));
}

async function logout() {
  await api('/logout', { method: 'POST' }).catch(() => {});
  state.user = null;
  location.hash = '#/';
  route();
}

function route() {
  clearInterval(state.pollTimer);
  setNav();
  if (!state.user) return renderAuth();
  const hash = location.hash || '#/';
  if (hash.startsWith('#/admin')) {
    if (!state.user.isAdmin) { location.hash = '#/'; return; }
    return renderAdmin(hash.split('/')[2] || 'overview', hash.split('/')[3]);
  }
  renderGuest().catch((ex) => state.user && toast(ex.message, true));
}

window.addEventListener('hashchange', route);

// ---------- Anmelden / Registrieren ----------

function renderAuth(mode = 'login') {
  const err = h('p', { class: 'error' });
  const isReg = mode === 'register';

  const fields = isReg
    ? [
        field('Anzeigename (z. B. Vorname)', 'displayName', 'text', 'name'),
        field('Benutzername', 'username', 'text', 'username'),
        field('Passwort (mind. 6 Zeichen)', 'password', 'password', 'new-password'),
        state.config.registrationCodeRequired && field('Einladungscode', 'code', 'text', 'off'),
      ]
    : [field('Benutzername', 'username', 'text', 'username'), field('Passwort', 'password', 'password', 'current-password')];

  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    const data = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api(isReg ? '/register' : '/login', { method: 'POST', body: data });
      await loadMe();
      location.hash = '#/';
      route();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  } }, ...fields, err, h('button', { class: 'btn primary block', type: 'submit' }, isReg ? 'Konto erstellen' : 'Anmelden'));

  $app.replaceChildren(h('div', { class: 'auth card' },
    h('div', { class: 'tabs' },
      h('button', { class: isReg ? '' : 'active', onclick: () => renderAuth('login') }, 'Anmelden'),
      h('button', { class: isReg ? 'active' : '', onclick: () => renderAuth('register') }, 'Registrieren')),
    form));
  form.querySelector('input')?.focus();
}

function field(labelText, name, type, autocomplete) {
  const id = 'f_' + name;
  return h('div', {},
    h('label', { for: id }, labelText),
    h('input', { id, name, type, autocomplete, required: true, autocapitalize: name === 'displayName' ? 'words' : 'none' }));
}

// ---------- Gast-Ansicht: nur Plus ----------

const eventKey = (ev) => (ev ? `${ev.id}:${ev.endedAt || ''}` : '');


// Bestenliste unter den Plus-Knöpfen. Admins sehen sie immer, Gäste nur wenn eingeschaltet.
function drawBoard(el, l) {
  if (!l.board) return el.replaceChildren();
  const tile = (icon, [one, many], top) => h('div', { class: 'card stat' },
    h('div', { class: 'l' }, `${icon} Meiste ${many}`),
    h('div', { class: 'v' }, top ? top.name : '–'),
    h('div', { class: 'muted small' }, top ? `${top.count} ${top.count === 1 ? one : many}` : 'Noch niemand'));
  el.replaceChildren(
    h('h2', { style: 'margin-top:20px' }, 'Bestenliste'),
    l.boardVisible ? '' : h('p', { class: 'muted small' }, 'Nur Admins sehen das. Für alle einschalten: Admin → Event.'),
    h('div', { class: 'board' }, tile('🍺', ['Bier', 'Biere'], l.board.bier), tile('🍹', ['Mischgetränk', 'Mischgetränke'], l.board.misch)));
}

async function renderGuest() {
  const [{ drinks }, summary, live] = await Promise.all([api('/drinks'), api('/me/summary'), api('/live')]);
  setEvent(summary.event);
  const board = h('div');
  drawBoard(board, live);
  // Startet/endet das Event oder gibt der Admin frei, wechselt die Ansicht von selbst. Sonst: Bestenliste aktualisieren.
  const key = (l) => `${eventKey(l.event)}|${l.approved}`;
  const first = key(live);
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    const l = await api('/live').catch(() => null);
    if (!l) return;
    if (key(l) !== first) return loadMe().then(route);
    drawBoard(board, l);
  }, 10000);

  if (!live.approved) {
    $app.replaceChildren(h('div', { class: 'card center stack' },
      h('h2', {}, `Hallo ${state.user.displayName}!`),
      h('p', { class: 'muted' }, 'Dein Konto wartet auf Freigabe durch den Admin. Danach kannst du Getränke buchen. Die Seite aktualisiert sich von selbst.')));
    return;
  }
  if (!summary.event) {
    $app.replaceChildren(h('div', { class: 'card muted center' }, 'Gerade läuft kein Event. Bitte warte, bis der Admin es startet.'));
    return;
  }
  if (summary.event.endedAt) return renderBill(summary);

  const counts = new Map(summary.perDrink.map((r) => [r.drinkId, r.count]));
  const totalCount = h('span', { class: 'num' });
  const totalSum = h('span', { class: 'num' });

  function updateTotals(s) {
    totalCount.textContent = `${s.totalCount} Getränk${s.totalCount === 1 ? '' : 'e'}`;
    totalSum.textContent = fmt(s.totalCents);
  }
  updateTotals(summary);

  const list = drinks.map((d) => {
    const countEl = h('div', { class: 'count', 'aria-label': 'Anzahl' }, counts.get(d.id) || 0);
    const btn = h('button', { class: 'plus', 'aria-label': `${d.name} +1`, onclick: async () => {
      btn.disabled = true;
      try {
        const s = await api('/consumptions', { method: 'POST', body: { drinkId: d.id } });
        vibrate();
        const row = s.perDrink.find((r) => r.drinkId === d.id);
        countEl.textContent = row ? row.count : 0;
        updateTotals(s);
        toast(`+1 ${d.name}`);
      } catch (ex) {
        toast(ex.message, true);
      } finally {
        setTimeout(() => (btn.disabled = false), 400);
      }
    } }, '+');
    return h('div', { class: 'drink' },
      h('div', { class: 'info' }, h('div', { class: 'name' }, d.name), h('div', { class: 'muted small' }, fmt(d.priceCents))),
      countEl, btn);
  });

  $app.replaceChildren(
    h('div', { class: 'hello' },
      h('h1', {}, `Hallo ${state.user.displayName}!`),
      h('span', { class: 'muted small' }, 'Tippe + für jedes Getränk')),
    drinks.length
      ? h('div', { class: 'drinks' }, list)
      : h('div', { class: 'card muted center' }, 'Noch keine Getränke angelegt.'),
    board,
    h('div', { class: 'totalbar' }, totalCount, totalSum),
  );
}

// ---------- Abrechnung nach dem Event ----------

function renderBill(s) {
  const p = s.payment;
  const copyRow = (label, value) => h('div', { class: 'copyrow' },
    h('div', {}, h('div', { class: 'muted small' }, label), h('div', { class: 'num' }, value)),
    h('button', { class: 'btn sm', onclick: () => navigator.clipboard.writeText(value)
      .then(() => toast(`${label} kopiert`), () => toast('Kopieren geht hier nicht.', true)) }, 'Kopieren'));

  $app.replaceChildren(
    h('div', { class: 'hello' },
      h('h1', {}, 'Der Abend ist vorbei!'),
      h('span', { class: 'muted small' }, `Danke, ${state.user.displayName}.`)),
    h('div', { class: 'scroll' }, h('table', {},
      h('tbody', {}, s.perDrink.map((r) => h('tr', {},
        h('td', {}, `${r.count} × ${r.name}`),
        h('td', { class: 'right num' }, fmt(r.totalCents))))),
      h('tfoot', {}, h('tr', {}, h('td', {}, 'Gesamt'), h('td', { class: 'right num' }, fmt(s.totalCents)))))),
    h('div', { style: 'height:12px' }),
    !p
      ? h('div', { class: 'card center' }, 'Du musst nichts bezahlen.')
      : h('div', { class: 'card stack' },
          h('h2', {}, `Bitte ${fmt(p.amountCents)} bezahlen`),
          p.paypalUrl && h('a', { class: 'btn primary block', href: p.paypalUrl, target: '_blank', rel: 'noopener' }, 'Mit PayPal bezahlen'),
          p.qr && [
            h('p', { class: 'muted small' }, 'Überweisung: Scanne den QR-Code mit deiner Banking-App (Funktion „GiroCode“ oder „Foto-Überweisung“). Auf dem eigenen Handy: Mach einen Screenshot und öffne ihn in der Banking-App, oder kopiere die Daten.'),
            h('img', { class: 'qr', src: p.qr, alt: 'QR-Code für die Überweisung', width: 260, height: 260 }),
            copyRow('Empfänger', p.payeeName),
            copyRow('IBAN', p.iban),
            copyRow('Betrag', (p.amountCents / 100).toFixed(2).replace('.', ',')),
            copyRow('Verwendungszweck', p.reference),
          ]),
  );
}

// ---------- Admin ----------

const ADMIN_TABS = [
  ['overview', 'Übersicht'],
  ['event', 'Event'],
  ['drinks', 'Getränke'],
  ['users', 'Personen'],
  ['log', 'Protokoll'],
];

function renderAdmin(tab, arg) {
  const body = h('div');
  $app.replaceChildren(
    h('div', { class: 'tabs', role: 'tablist' },
      ADMIN_TABS.map(([key, label]) =>
        h('button', { class: key === tab ? 'active' : '', role: 'tab', onclick: () => (location.hash = `#/admin/${key}`) }, label))),
    body);
  const views = { overview: adminOverview, event: adminEvent, drinks: adminDrinks, users: adminUsers, log: adminLog };
  (views[tab] || adminOverview)(body, arg).catch((ex) => toast(ex.message, true));
}

async function adminOverview(body) {
  async function load() {
    const data = await api('/admin/overview');
    setEvent(data.event);
    draw(data);
  }

  function draw({ event, users: all, drinks, cells }) {
    const users = all.filter((u) => u.approved);
    const pending = all.length - users.length;
    const notice = pending ? h('a', { class: 'card notice', href: '#/admin/users' },
      `${pending} ${pending === 1 ? 'Person wartet' : 'Personen warten'} auf Freigabe → Personen`) : null;
    if (!event) {
      body.replaceChildren(notice || '', h('div', { class: 'card muted center' }, 'Noch kein Event. Starte eins im Tab „Event“.'));
      return;
    }
    const open = !event.endedAt;
    const map = new Map(cells.map((c) => [`${c.userId}:${c.drinkId}`, c]));
    // Inaktive Getränke nur zeigen, wenn es Buchungen dafür gibt.
    const cols = drinks.filter((d) => d.active || cells.some((c) => c.drinkId === d.id));
    let grandCount = 0;
    let grandCents = 0;
    const colTotals = new Map();

    const rows = users.map((u) => {
      let rowCents = 0;
      const tds = cols.map((d) => {
        const c = map.get(`${u.id}:${d.id}`);
        const n = c ? c.count : 0;
        rowCents += c ? c.totalCents : 0;
        grandCount += n;
        colTotals.set(d.id, (colTotals.get(d.id) || 0) + n);
        return h('td', { class: 'cell' }, open ? stepper(u, d, n) : h('span', { class: 'num' }, n));
      });
      grandCents += rowCents;
      return h('tr', {},
        h('td', {}, u.displayName, ' ', u.isAdmin ? h('span', { class: 'badge' }, 'Admin') : null,
          h('div', { class: 'muted small' }, '@' + u.username)),
        tds,
        h('td', { class: 'right num' }, fmt(rowCents)));
    });

    body.replaceChildren(
      notice || '',
      h('div', { class: 'stats' },
        stat(users.length, 'Personen'),
        stat(grandCount, 'Getränke gesamt'),
        stat(fmt(grandCents), 'Umsatz gesamt')),
      h('div', { class: 'toolbar' },
        h('span', { class: 'muted small' }, open ? 'Aktualisiert sich alle 5 Sekunden.' : 'Event beendet. Die Liste ist fest.'),
        h('a', { class: 'btn sm', href: '/api/admin/export.csv' }, 'CSV-Export')),
      cols.length === 0
        ? h('div', { class: 'card muted center' }, 'Noch keine Getränke. Lege sie im Tab „Getränke“ an.')
        : h('div', { class: 'scroll' }, h('table', { class: 'matrix' },
            h('thead', {}, h('tr', {},
              h('th', {}, 'Person'),
              cols.map((d) => h('th', { class: 'cell' }, d.name, h('div', { class: 'small' }, fmt(d.priceCents)))),
              h('th', { class: 'right' }, 'Summe'))),
            h('tbody', {}, rows),
            h('tfoot', {}, h('tr', {},
              h('td', {}, 'Gesamt'),
              cols.map((d) => h('td', { class: 'cell num' }, colTotals.get(d.id) || 0)),
              h('td', { class: 'right num' }, fmt(grandCents)))))),
    );
  }

  function stepper(u, d, n) {
    const send = async (path) => {
      try {
        await api(path, { method: 'POST', body: { userId: u.id, drinkId: d.id } });
        await load();
      } catch (ex) {
        toast(ex.message, true);
      }
    };
    return h('span', { class: 'stepper' },
      h('button', { class: 'minus', 'aria-label': `${d.name} −1 für ${u.displayName}`, disabled: n === 0, onclick: () => send('/admin/consumptions/undo') }, '−'),
      h('span', { class: 'n' + (n === 0 ? ' zero' : '') }, n),
      h('button', { 'aria-label': `${d.name} +1 für ${u.displayName}`, onclick: () => send('/admin/consumptions') }, '+'));
  }

  await load();
  state.pollTimer = setInterval(() => load().catch(() => {}), 5000);
}

function stat(value, label) {
  return h('div', { class: 'card stat' }, h('div', { class: 'v' }, value), h('div', { class: 'l' }, label));
}

function inputField(labelText, name, value, placeholder) {
  const id = 'f_' + name;
  return h('div', {}, h('label', { for: id }, labelText),
    h('input', { id, name, type: 'text', value, placeholder, autocomplete: 'off', autocapitalize: 'none' }));
}

function eventList(events) {
  if (!events.length) return ''; // '' statt null: replaceChildren schreibt null sonst als Text
  return h('div', {},
    h('h2', { style: 'margin-top:20px' }, 'Alle Events'),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Event'), h('th', {}, 'Jahr'), h('th', { class: 'right' }, 'Summe'), h('th', { class: 'right' }, 'Bezahlt'))),
      h('tbody', {}, events.map((e) => h('tr', { class: 'link-row', onclick: () => (location.hash = `#/admin/event/${e.id}`) },
        h('td', {}, h('a', { href: `#/admin/event/${e.id}` }, e.name), e.endedAt ? null : [' ', h('span', { class: 'badge' }, 'läuft')]),
        h('td', { class: 'small muted' }, e.year),
        h('td', { class: 'right num' }, fmt(e.totalCents)),
        h('td', { class: 'right num' }, `${e.paid}/${e.people}`)))))));
}

// Ein Event: jede Person mit Endsumme, aufklappbarer Getränkeliste und Haken „bezahlt“.
// Text zum Kopieren für Personen, die noch nicht (vollständig) bezahlt haben.
function reminderText(event, pay, p, openCents) {
  const lines = [`Getränke-Abrechnung – ${event.label}`, '', `Hi ${p.displayName},`, '',
    `vom Event „${event.label}“ sind bei dir noch ${fmt(openCents)} für Getränke offen. Kannst du den Betrag bitte möglichst bald überweisen?`];
  if (pay.iban) {
    lines.push('', `Empfänger: ${pay.payeeName}`, `IBAN: ${pay.iban.replace(/(.{4})/g, '$1 ').trim()}`,
      `Betrag: ${fmt(openCents)}`, `Verwendungszweck: ${p.reference}`);
  }
  // Gleiches Link-Format wie paymentInfo in src/app.js.
  if (pay.paypal) lines.push('', `${pay.iban ? 'Alternativ geht es auch' : 'Am einfachsten geht es'} per PayPal: https://paypal.me/${pay.paypal}/${(openCents / 100).toFixed(2)}EUR`);
  lines.push('', 'Danke dir und viele Grüße!');
  return lines.join('\n');
}

// Inventur: gebucht vs. tatsächlich weg. Die Differenz ist nicht abgerechnet.
function inventorySection(event, inventory) {
  const summary = h('p', { class: 'inv-summary' });
  const foot = h('tr');
  const signed = (n) => (n > 0 ? `+${n}` : String(n));
  const rows = inventory.map((r) => {
    const input = h('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', class: 'inline-input inv',
      value: r.actual ?? '', placeholder: '–', 'aria-label': `${r.name}: tatsächlich weg`, oninput: draw });
    const diff = h('td', { class: 'right num' });
    return { r, input, diff, tr: h('tr', {}, h('td', {}, r.name), h('td', { class: 'right num' }, r.booked), h('td', {}, input), diff) };
  });

  function draw() {
    let booked = 0;
    let actual = 0;
    let missing = 0; // nur positive Differenzen: weg, aber nicht gebucht
    let over = 0; // nur negative Differenzen: gebucht, aber nicht weg. Getrennt, damit sich beides nicht aufhebt.
    let counted = 0;
    for (const x of rows) {
      booked += x.r.booked;
      if (x.input.value === '') {
        x.diff.textContent = '–';
        x.diff.className = 'right num muted';
        continue;
      }
      const d = Number(x.input.value) - x.r.booked;
      actual += Number(x.input.value);
      if (d > 0) missing += d;
      else over -= d;
      counted++;
      x.diff.textContent = signed(d);
      x.diff.className = 'right num' + (d > 0 ? ' error' : '');
    }
    foot.replaceChildren(h('td', {}, 'Gesamt'), h('td', { class: 'right num' }, booked),
      h('td', { class: 'num' }, counted ? actual : '–'), h('td', { class: 'right num' }, counted ? signed(missing) : '–'));
    const parts = [];
    if (missing) parts.push(`${missing} ${missing === 1 ? 'Getränk fehlt' : 'Getränke fehlen'} ohne Abrechnung.`);
    if (over) parts.push(`${over} mehr gebucht als tatsächlich weg.`);
    summary.textContent = !counted ? 'Trage ein, wie viele Getränke tatsächlich weg sind.'
      : parts.length ? parts.join(' ') : 'Alles stimmt. Nichts fehlt.';
    summary.className = 'inv-summary' + (missing > 0 ? ' error' : '');
  }
  draw();

  const save = h('button', { class: 'btn primary', onclick: async () => {
    try {
      const counts = Object.fromEntries(rows.map((x) => [x.r.drinkId, x.input.value]));
      await api(`/admin/events/${event.id}/inventory`, { method: 'PUT', body: { counts } });
      toast('Inventur gespeichert');
    } catch (ex) { toast(ex.message, true); }
  } }, 'Inventur speichern');

  return h('div', { class: 'card stack', style: 'margin-top:20px' },
    h('h2', {}, 'Inventur'),
    h('p', { class: 'muted small' }, 'Zähle am Ende, wie viele Getränke tatsächlich weg sind, z. B. leere Flaschen, und trage sie bei „Weg“ ein. „Fehlt“ = weg, aber nicht gebucht.'),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Getränk'), h('th', { class: 'right' }, 'Gebucht'), h('th', {}, 'Weg'), h('th', { class: 'right' }, 'Fehlt'))),
      h('tbody', {}, rows.map((x) => x.tr)),
      h('tfoot', {}, foot))),
    summary,
    save);
}

// Fragt beim Abhaken, wie viel die Person tatsächlich bezahlt hat. Gibt den Betrag als Text zurück, null = Abbrechen.
function askPaid(p) {
  return new Promise((resolve) => {
    const amount = h('input', { id: 'pay_amount', type: 'text', inputmode: 'decimal', value: (p.totalCents / 100).toFixed(2).replace('.', ',') });
    const done = (value) => { dlg.close(); dlg.remove(); resolve(value); };
    const dlg = h('dialog', { class: 'card paydialog' },
      h('div', { class: 'stack' },
        h('h2', {}, `Hat ${p.displayName} bezahlt?`),
        h('p', {}, 'Zu zahlen: ', h('b', {}, fmt(p.totalCents))),
        h('button', { class: 'btn primary block', onclick: () => done(String(p.totalCents / 100)) }, `Ja, genau ${fmt(p.totalCents)}`),
        h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); done(amount.value); } },
          h('label', { for: 'pay_amount' }, 'Anderer Betrag insgesamt in € (z. B. mit Spende oder nur ein Teil)'),
          amount,
          h('button', { class: 'btn block', type: 'submit' }, 'Diesen Betrag speichern')),
        h('button', { class: 'btn ghost block', onclick: () => done(null) }, 'Abbrechen')));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); }); // Esc-Taste
    document.body.append(dlg);
    dlg.showModal();
  });
}

async function adminEventDetail(body, id) {
  const { event, people, payment, inventory } = await api(`/admin/events/${id}`);
  const stats = h('div', { class: 'stats' });
  const openOf = (p) => Math.max(0, p.totalCents - (p.paidCents || 0));
  const extraOf = (p) => Math.max(0, (p.paidCents || 0) - p.totalCents);
  const sum = (f) => people.reduce((s, p) => s + f(p), 0);
  const drawStats = () => {
    // Bezahlt = tatsächlich eingenommen, inklusive Spenden. Kann darum über der Summe liegen.
    const extra = sum(extraOf);
    stats.replaceChildren(
      stat(fmt(sum((p) => p.totalCents)), 'Summe'),
      stat(fmt(sum((p) => p.paidCents || 0)), extra ? `Bezahlt, davon ${fmt(extra)} extra` : 'Bezahlt'),
      stat(fmt(sum(openOf)), 'Offen'));
  };
  drawStats();

  const cards = people.map((p) => {
    const full = () => p.paidCents != null && p.paidCents >= p.totalCents;
    const open = () => openOf(p);
    const note = h('div', { class: 'small' });
    const copyBtn = h('button', { class: 'btn sm', onclick: () => navigator.clipboard.writeText(reminderText(event, payment, p, open()))
      .then(() => toast(`Erinnerung für ${p.displayName} kopiert`), () => toast('Kopieren geht hier nicht.', true)) }, 'Erinnerung kopieren');
    const drawNote = () => {
      const partial = p.paidCents != null && !full();
      note.textContent = partial ? `${fmt(p.paidCents)} bezahlt, ${fmt(open())} offen`
        : extraOf(p) ? `${fmt(p.paidCents)} bezahlt, davon ${fmt(extraOf(p))} extra` : '';
      note.className = 'small' + (partial ? ' error' : extraOf(p) ? ' ok' : '');
      copyBtn.hidden = full();
      card.classList.toggle('paid', full());
      box.checked = full();
    };
    const box = h('input', { type: 'checkbox', onchange: async () => {
      let body = { paid: false };
      if (box.checked) {
        const amount = await askPaid(p);
        if (amount === null) return drawNote(); // abgebrochen: alter Zustand
        body = { paid: true, amount };
      }
      try {
        const r = await api(`/admin/events/${event.id}/payments/${p.userId}`, { method: 'PUT', body });
        p.paidCents = r.paidCents;
        drawNote();
        drawStats();
        toast(`${p.displayName}: ${p.paidCents == null ? 'offen' : `${fmt(p.paidCents)} bezahlt`}`);
      } catch (ex) {
        drawNote();
        toast(ex.message, true);
      }
    } });
    const card = h('div', { class: 'card person' },
      h('div', { class: 'person-head' },
        h('div', { class: 'who' }, h('div', { class: 'name' }, p.displayName), h('div', { class: 'muted small' }, '@' + p.username)),
        h('div', { class: 'total num' }, fmt(p.totalCents)),
        h('label', { class: 'paidbox' }, box, 'bezahlt')),
      h('div', { class: 'person-actions' }, note, copyBtn),
      h('details', {},
        h('summary', {}, `Getränke anzeigen (${p.totalCount})`),
        h('table', {}, h('tbody', {}, p.drinks.map((d) => h('tr', {},
          h('td', {}, `${d.count} × ${d.name}`),
          h('td', { class: 'right num' }, fmt(d.totalCents))))))));
    drawNote();
    return card;
  });

  body.replaceChildren(
    h('a', { class: 'btn sm ghost', href: '#/admin/event' }, '← Alle Events'),
    h('h2', { style: 'margin-top:12px' }, event.name),
    h('p', { class: 'muted small' }, `${event.year} · ${event.endedAt ? 'beendet' : 'läuft noch'}`),
    stats,
    people.length
      ? h('div', { class: 'stack' }, cards)
      : h('div', { class: 'card muted center' }, 'In diesem Event gibt es keine Buchungen.'),
    inventorySection(event, inventory));
}

async function adminEvent(body, id) {
  if (id) return adminEventDetail(body, id);
  const [{ event }, settings, { events }] = await Promise.all([api('/me'), api('/admin/settings'), api('/admin/events')]);
  setEvent(event);
  const err = h('p', { class: 'error' });
  const boardBox = h('input', { type: 'checkbox', checked: settings.scoreboard, onchange: async () => {
    try {
      await api('/admin/scoreboard', { method: 'PUT', body: { visible: boardBox.checked } });
      toast(boardBox.checked ? 'Bestenliste für alle sichtbar' : 'Bestenliste nur für Admins');
    } catch (ex) {
      boardBox.checked = !boardBox.checked;
      toast(ex.message, true);
    }
  } });
  const boardCard = h('div', { class: 'card', style: 'margin-top:12px' },
    h('label', { class: 'paidbox' }, boardBox, 'Bestenliste für alle Gäste sichtbar'),
    h('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'Zeigt unter den Plus-Knöpfen, wer am meisten Bier und Mischgetränke hatte.'));

  if (!event || event.endedAt) {
    const form = h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      if (event && !confirm(`Neues Event starten? Die Gäste sehen dann ihre Abrechnung von „${event.name}“ nicht mehr. Du findest sie weiter unten unter „Alle Events“.`)) return;
      try {
        await api('/admin/events', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
        toast('Event gestartet');
        adminEvent(body);
      } catch (ex) { err.textContent = ex.message; }
    } },
      inputField('Name des Events', 'name', '', 'z. B. Sommerfest 2026'),
      err,
      h('button', { class: 'btn primary block', type: 'submit' }, 'Event starten'));
    body.replaceChildren(
      event ? h('div', { class: 'card stack' },
        h('p', {}, `Letztes Event: ${event.name} (beendet).`),
        h('button', { class: 'btn', onclick: async () => {
          if (!confirm(`„${event.name}“ wieder öffnen? Die Gäste können dann wieder buchen.`)) return;
          try {
            await api('/admin/events/reopen', { method: 'POST' });
            toast('Event wieder geöffnet');
            adminEvent(body);
          } catch (ex) { toast(ex.message, true); }
        } }, 'Event wieder öffnen')) : '',
      event ? h('div', { style: 'height:12px' }) : '',
      h('div', { class: 'card stack' }, h('h2', {}, 'Neues Event'), form),
      boardCard,
      eventList(events));
    return;
  }

  const endForm = h('form', { class: 'stack', hidden: true, onsubmit: async (e) => {
    e.preventDefault();
    if (!confirm(`„${event.name}“ beenden? Danach kann niemand mehr buchen.`)) return;
    try {
      await api('/admin/events/end', { method: 'POST', body: Object.fromEntries(new FormData(endForm)) });
      toast('Event beendet. Die Gäste sehen jetzt ihre Abrechnung.');
      adminEvent(body);
    } catch (ex) { err.textContent = ex.message; }
  } },
    h('p', { class: 'muted small' }, 'Trage deine Zahlungsdaten ein. Die Gäste sehen danach ihre Summe, einen QR-Code für die Überweisung und den PayPal-Link.'),
    inputField('Kontoinhaber', 'payeeName', settings.payeeName, 'Vorname Nachname'),
    inputField('IBAN', 'iban', settings.iban, 'DE12 3456 …'),
    inputField('PayPal.me-Link (optional)', 'paypal', settings.paypal && `paypal.me/${settings.paypal}`, 'paypal.me/deinname'),
    err,
    h('button', { class: 'btn primary block', type: 'submit' }, 'Fertig'));

  body.replaceChildren(h('div', { class: 'card stack' },
    h('h2', {}, `Läuft: ${event.name}`),
    h('button', { class: 'btn danger', onclick: (e) => { e.currentTarget.hidden = true; endForm.hidden = false; } }, 'Event beenden'),
    endForm),
    boardCard,
    eventList(events));
}

function categorySelect(attrs, value) {
  const sel = h('select', attrs, Object.entries(state.config.categories || {}).map(([k, label]) => h('option', { value: k }, label)));
  sel.value = value;
  return sel;
}

async function adminDrinks(body) {
  const { drinks } = await api('/admin/overview');
  const err = h('p', { class: 'error' });

  const addForm = h('form', { class: 'row-form', onsubmit: async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(addForm));
    try {
      await api('/admin/drinks', { method: 'POST', body: data });
      toast(`${data.name} angelegt`);
      adminDrinks(body);
    } catch (ex) { err.textContent = ex.message; }
  } },
    h('div', {}, h('label', { for: 'nd_name' }, 'Name'), h('input', { id: 'nd_name', name: 'name', type: 'text', required: true, placeholder: 'z. B. Bier 0,5 l' })),
    h('div', {}, h('label', { for: 'nd_price' }, 'Preis (€)'), h('input', { id: 'nd_price', name: 'price', type: 'text', inputmode: 'decimal', placeholder: '3,50', required: true })),
    h('div', {}, h('label', { for: 'nd_cat' }, 'Kategorie'), categorySelect({ id: 'nd_cat', name: 'category' }, 'bier')),
    h('button', { class: 'btn primary', type: 'submit' }, 'Hinzufügen'));

  const rows = drinks.map((d) => {
    const name = h('input', { type: 'text', class: 'inline-input', value: d.name, 'aria-label': 'Name' });
    const price = h('input', { type: 'text', class: 'inline-input', inputmode: 'decimal', value: (d.priceCents / 100).toFixed(2).replace('.', ','), 'aria-label': 'Preis', style: 'max-width:90px' });
    const cat = categorySelect({ class: 'inline-input', 'aria-label': 'Kategorie' }, d.category);
    const save = async (patch, msg) => {
      try {
        await api(`/admin/drinks/${d.id}`, { method: 'PUT', body: patch });
        toast(msg);
        adminDrinks(body);
      } catch (ex) { toast(ex.message, true); }
    };
    return h('tr', {},
      h('td', {}, name),
      h('td', {}, price),
      h('td', {}, cat),
      h('td', {}, d.active ? 'aktiv' : h('span', { class: 'muted' }, 'inaktiv')),
      h('td', {}, h('div', { class: 'actions' },
        h('button', { class: 'btn sm primary', onclick: () => save({ name: name.value, price: price.value, category: cat.value }, 'Gespeichert') }, 'Speichern'),
        h('button', { class: 'btn sm', onclick: () => save({ active: !d.active }, d.active ? 'Deaktiviert' : 'Aktiviert') }, d.active ? 'Deaktivieren' : 'Aktivieren'),
        h('button', { class: 'btn sm danger', onclick: async () => {
          if (!confirm(`„${d.name}“ löschen?`)) return;
          try {
            await api(`/admin/drinks/${d.id}`, { method: 'DELETE' });
            toast('Gelöscht');
            adminDrinks(body);
          } catch (ex) { toast(ex.message, true); }
        } }, 'Löschen'))));
  });

  body.replaceChildren(
    h('div', { class: 'card stack' }, h('h2', {}, 'Neues Getränk'), addForm, err),
    h('p', { class: 'muted small' }, 'Preisänderungen gelten nur für neue Buchungen. Inaktive Getränke sehen Gäste nicht.'),
    drinks.length
      ? h('div', { class: 'scroll' }, h('table', { style: 'min-width:680px' }, // auf dem Handy seitlich scrollen statt quetschen
          h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Preis (€)'), h('th', {}, 'Kategorie'), h('th', {}, 'Status'), h('th', {}))),
          h('tbody', {}, rows)))
      : '',
  );
}

async function adminUsers(body) {
  const [{ users }, who] = await Promise.all([api('/admin/overview'), api('/admin/whoami')]);
  const call = async (path, opts, msg) => {
    try {
      await api(path, opts);
      toast(msg);
      adminUsers(body);
    } catch (ex) { toast(ex.message, true); }
  };

  // Wartende zuerst.
  const sorted = [...users].sort((a, b) => a.approved - b.approved);
  const rows = sorted.map((u) => h('tr', {},
    h('td', {}, u.displayName, h('div', { class: 'muted small' }, '@' + u.username)),
    h('td', {}, u.isAdmin ? h('span', { class: 'badge' }, 'Admin') : u.approved ? 'Gast' : h('span', { class: 'badge wait' }, 'wartet')),
    h('td', {}, h('div', { class: 'actions' },
      !u.approved && h('button', { class: 'btn sm primary', onclick: () => call(`/admin/users/${u.id}`, { method: 'PUT', body: { approved: true } }, `${u.displayName} freigegeben`) }, 'Freigeben'),
      h('button', { class: 'btn sm', onclick: () => call(`/admin/users/${u.id}`, { method: 'PUT', body: { isAdmin: !u.isAdmin } }, 'Rolle geändert') },
        u.isAdmin ? 'Admin entziehen' : 'Zum Admin machen'),
      h('button', { class: 'btn sm', onclick: () => {
        const pw = prompt(`Neues Passwort für ${u.displayName} (mind. 6 Zeichen):`);
        if (pw) call(`/admin/users/${u.id}`, { method: 'PUT', body: { password: pw } }, 'Passwort gesetzt');
      } }, 'Passwort setzen'),
      u.id !== state.user.id && h('button', { class: 'btn sm danger', onclick: () => {
        if (confirm(`${u.displayName} und alle Buchungen dieser Person löschen?`)) {
          call(`/admin/users/${u.id}`, { method: 'DELETE' }, 'Gelöscht');
        }
      } }, 'Löschen')))));

  body.replaceChildren(
    h('p', { class: 'muted small' }, 'Gäste registrieren sich selbst über die Startseite. Danach gibst du sie hier frei. Ablehnen = Löschen.'),
    h('p', { class: 'muted small' }, `Deine IP laut Server: ${who.ip} (TRUST_PROXY=${who.trustProxy}, X-Forwarded-For: ${who.forwardedFor || '–'})`),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Person'), h('th', {}, 'Rolle'), h('th', {}))),
      h('tbody', {}, rows))));
}

async function adminLog(body) {
  const { log } = await api('/admin/log?limit=200');
  body.replaceChildren(
    h('p', { class: 'muted small' }, 'Letzte 200 Buchungen des aktuellen Events. Durchgestrichen = vom Admin entfernt.'),
    log.length === 0
      ? h('div', { class: 'card muted center' }, 'Noch keine Buchungen.')
      : h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Zeit'), h('th', {}, 'Person'), h('th', {}, 'Getränk'), h('th', { class: 'right' }, 'Preis'), h('th', {}, 'Info'))),
          h('tbody', {}, log.map((r) => h('tr', { class: r.deletedAt ? 'strike' : '' },
            h('td', { class: 'num small' }, time(r.createdAt)),
            h('td', {}, r.userName),
            h('td', {}, r.drinkName),
            h('td', { class: 'right num' }, fmt(r.priceCents)),
            h('td', { class: 'small muted' },
              r.createdByName && r.createdByName !== r.userName ? `gebucht von ${r.createdByName}` : '',
              r.deletedAt ? ` entfernt von ${r.deletedByName || '?'}` : '')))))));
}

// ---------- Start ----------

async function loadMe() {
  const { user, event } = await api('/me');
  state.user = user;
  state.event = event;
}

(async function init() {
  try {
    const [config] = await Promise.all([api('/config'), loadMe()]);
    state.config = config;
  } catch (ex) {
    toast(ex.message, true);
  }
  route();
})();
