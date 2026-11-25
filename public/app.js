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
  if (ev) $eventbar.textContent = ev.name + (ev.endedAt ? ' · beendet' : '');
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
    return renderAdmin(hash.split('/')[2] || 'overview');
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

async function renderGuest() {
  const [{ drinks }, summary] = await Promise.all([api('/drinks'), api('/me/summary')]);
  setEvent(summary.event);
  // Startet oder endet das Event, wechselt die Ansicht von selbst.
  const key = eventKey(summary.event);
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    const s = await api('/me').catch(() => null);
    if (s && eventKey(s.event) !== key) route();
  }, 10000);

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

function renderAdmin(tab) {
  const body = h('div');
  $app.replaceChildren(
    h('div', { class: 'tabs', role: 'tablist' },
      ADMIN_TABS.map(([key, label]) =>
        h('button', { class: key === tab ? 'active' : '', role: 'tab', onclick: () => (location.hash = `#/admin/${key}`) }, label))),
    body);
  const views = { overview: adminOverview, event: adminEvent, drinks: adminDrinks, users: adminUsers, log: adminLog };
  (views[tab] || adminOverview)(body).catch((ex) => toast(ex.message, true));
}

async function adminOverview(body) {
  async function load() {
    const data = await api('/admin/overview');
    setEvent(data.event);
    draw(data);
  }

  function draw({ event, users, drinks, cells }) {
    if (!event) {
      body.replaceChildren(h('div', { class: 'card muted center' }, 'Noch kein Event. Starte eins im Tab „Event“.'));
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

async function adminEvent(body) {
  const [{ event }, settings] = await Promise.all([api('/me'), api('/admin/settings')]);
  setEvent(event);
  const err = h('p', { class: 'error' });

  if (!event || event.endedAt) {
    const form = h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      if (event && !confirm(`Die Abrechnung von „${event.name}“ verschwindet dann für alle Gäste und aus der Übersicht. Hast du vorher die CSV exportiert (Tab Übersicht)?`)) return;
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
        h('p', {}, `Letztes Event: ${event.name}, beendet am ${time(event.endedAt)}.`),
        h('button', { class: 'btn', onclick: async () => {
          if (!confirm(`„${event.name}“ wieder öffnen? Die Gäste können dann wieder buchen.`)) return;
          try {
            await api('/admin/events/reopen', { method: 'POST' });
            toast('Event wieder geöffnet');
            adminEvent(body);
          } catch (ex) { toast(ex.message, true); }
        } }, 'Event wieder öffnen')) : null,
      event ? h('div', { style: 'height:12px' }) : null,
      h('div', { class: 'card stack' }, h('h2', {}, 'Neues Event'), form));
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
    h('p', { class: 'muted small' }, `Gestartet am ${time(event.startedAt)}.`),
    h('button', { class: 'btn danger', onclick: (e) => { e.currentTarget.hidden = true; endForm.hidden = false; } }, 'Event beenden'),
    endForm));
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
    h('button', { class: 'btn primary', type: 'submit' }, 'Hinzufügen'));

  const rows = drinks.map((d) => {
    const name = h('input', { type: 'text', class: 'inline-input', value: d.name, 'aria-label': 'Name' });
    const price = h('input', { type: 'text', class: 'inline-input', inputmode: 'decimal', value: (d.priceCents / 100).toFixed(2).replace('.', ','), 'aria-label': 'Preis', style: 'max-width:90px' });
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
      h('td', {}, d.active ? 'aktiv' : h('span', { class: 'muted' }, 'inaktiv')),
      h('td', {}, h('div', { class: 'actions' },
        h('button', { class: 'btn sm primary', onclick: () => save({ name: name.value, price: price.value }, 'Gespeichert') }, 'Speichern'),
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
      ? h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Preis (€)'), h('th', {}, 'Status'), h('th', {}))),
          h('tbody', {}, rows)))
      : null,
  );
}

async function adminUsers(body) {
  const { users } = await api('/admin/overview');
  const call = async (path, opts, msg) => {
    try {
      await api(path, opts);
      toast(msg);
      adminUsers(body);
    } catch (ex) { toast(ex.message, true); }
  };

  const rows = users.map((u) => h('tr', {},
    h('td', {}, u.displayName, h('div', { class: 'muted small' }, '@' + u.username)),
    h('td', {}, u.isAdmin ? h('span', { class: 'badge' }, 'Admin') : 'Gast'),
    h('td', {}, h('div', { class: 'actions' },
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
    h('p', { class: 'muted small' }, 'Gäste registrieren sich selbst über die Startseite.'),
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
