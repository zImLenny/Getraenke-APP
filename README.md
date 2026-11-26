# Getränke-Zähler

Web-App für Veranstaltungen. Jeder Gast zählt seine Getränke selbst auf dem Handy.
Der Admin sieht, wer was getrunken hat, und korrigiert Fehler.

## Funktionen

**Gäste**
- Registrieren und anmelden (Benutzername + Passwort, optional mit Einladungscode).
- Neue Gäste warten auf Freigabe durch den Admin. Erst danach können sie buchen. Die Seite wechselt nach der Freigabe von selbst.
- Bestenliste unter den Plus-Knöpfen: Wer im laufenden Event am meisten Bier und am meisten Mischgetränke hatte. Aktualisiert sich alle 10 Sekunden.
- Für jedes Getränk einen großen **+**-Knopf. Es gibt **kein Minus**.
- Eigene Anzahl und eigene Summe in Euro sehen.
- Schutz gegen Doppel-Tipp (0,8 Sekunden).
- Läuft im Browser. Gäste können die Seite zum Startbildschirm hinzufügen (siehe [App aufs Telefon bringen](#app-aufs-telefon-bringen)).

**Events**
- Der Admin startet ein Event mit Namen, z. B. „Sommerfest 2026“. Der Name steht oben auf jeder Seite.
- Buchen geht nur, solange ein Event läuft. Jedes Event startet bei null.
- Zum Beenden trägt der Admin Kontoinhaber, IBAN und optional einen PayPal.me-Link ein und tippt auf „Fertig“.
- Danach ist die Liste fest. Niemand kann mehr buchen oder korrigieren.
- Aus Versehen beendet? Mit **„Event wieder öffnen“** geht es weiter, solange kein neues Event läuft.
- Ein neues Event versteckt die Abrechnung des alten für die Gäste. Die App warnt dich vor dem Start.
- Tab **Event** → **Alle Events**: Jedes Event, auch alte, mit Summe und Anzahl „bezahlt“.
- Ein Event öffnen: Jede Person mit Endsumme und aufklappbarer Getränkeliste. Mit einem Haken markierst du „bezahlt“. Ein Fenster fragt nach dem Betrag: „Ja, genau“ oder ein anderer Betrag. Mehr gilt als Spende, weniger lässt den Rest offen. „Bezahlt“ oben zeigt das tatsächlich eingenommene Geld inklusive Spenden. Kommen nach dem Haken Getränke dazu, ist der Rest wieder offen.
- **Erinnerung kopieren:** Bei offenem Betrag kopiert der Knopf einen fertigen Text mit Eventname, Jahr, Betrag, Bankdaten und PayPal-Link. Den Text schickst du z. B. per WhatsApp.
- **Inventur:** Unten in jedem Event trägst du pro Getränk ein, wie viele tatsächlich weg sind. Die App zeigt pro Getränk und gesamt, wie viele fehlen, ohne abgerechnet zu sein.
- Der Verwendungszweck enthält Eventname, Jahr und Name, z. B. „Getränke Sommerfest 2026 Max“. Steht das Jahr schon im Namen, kommt es nicht doppelt.
- Innerhalb von 10 Sekunden sehen alle Gäste ihre Abrechnung:
  - Was sie getrunken haben und was es kostet.
  - Einen QR-Code für die Überweisung („GiroCode“). Die Banking-App füllt damit Empfänger, IBAN, Betrag und Verwendungszweck aus.
  - Alle Bankdaten mit Knopf zum Kopieren.
  - Einen PayPal-Knopf mit dem fertigen Betrag.

**Admin**
- Übersicht: Tabelle Person × Getränk mit **+** und **−**. Aktualisiert sich alle 5 Sekunden.
- Summen pro Person, pro Getränk und gesamt.
- Getränke anlegen, umbenennen, Preis ändern, deaktivieren, löschen. Gäste sehen nur aktive Getränke.
- Jedes Getränk gehört zu einer Kategorie: **Bier**, **Mischgetränk**, **Alkoholfrei** oder **Sonstiges**. Die Bestenliste zählt nur Bier und Mischgetränke.
- Neue Gäste freigeben (Tab **Personen**). Die Übersicht zeigt einen Hinweis, sobald jemand wartet.
- Bestenliste für alle Gäste ein- oder ausschalten (Tab **Event**). Admins sehen sie immer.
- Preisänderungen gelten nur für neue Buchungen.
- Personen verwalten: Admin-Rechte geben, Passwort neu setzen, löschen. Beim Löschen entfernt die App auch alle Buchungen dieser Person. Das geht nur, wenn die Person keine offenen Beträge hat.
- Protokoll: jede Buchung des aktuellen Events mit Uhrzeit. Ein Minus löscht nichts, es markiert die Buchung.
- CSV-Export des aktuellen Events für Excel (Trennzeichen `;`, Beträge mit Komma).

## Lokal starten

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
```

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD=geheim123 npm start
```

Dann im Browser `http://localhost:3000` öffnen.

Tests:

```bash
npm test
```

## Einstellungen (Umgebungsvariablen)

| Variable | Zweck |
|---|---|
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Legt den Start-Admin an, solange es keinen Admin gibt. Ohne diese Werte wird die erste registrierte Person Admin. |
| `REGISTRATION_CODE` | Optional. Gäste brauchen diesen Code zum Registrieren. |
| `PORT` | Port des Servers. Standard: `3000`. |
| `DATABASE_URL` | Adresse der Turso-Datenbank, z. B. `libsql://name-konto.turso.io`. Ohne Wert nutzt die App eine lokale Datei. |
| `DATABASE_AUTH_TOKEN` | Zugangs-Token für Turso. |
| `DB_FILE` | Pfad zur lokalen SQLite-Datei, falls `DATABASE_URL` fehlt. Standard: `data/getraenke.db`. |
| `SECURE_COOKIES` | Auf `true` setzen, sobald die App über HTTPS läuft. |

Lokal liegen alle Daten in **einer** SQLite-Datei. Mit Turso liegen die Daten in der Cloud.

**Backup**
- Lokale Datei: Kopiere `data/getraenke.db`, während die App nicht läuft.
- Turso: Exportiere die Daten mit der Turso-CLI: `turso db shell <name> .dump > backup.sql`.

## Kostenlos online: Turso + Render (0 €)

Turso speichert die Daten. Render führt die App aus. Beide haben einen Gratis-Tarif.

**1. Datenbank bei Turso anlegen**

1. Auf turso.tech ein Konto anlegen.
2. Eine Datenbank anlegen, Region Frankfurt.
3. Die Datenbank-URL kopieren (`libsql://…`).
4. Ein Token erzeugen und kopieren.

**2. App bei Render starten**

1. Auf render.com ein Konto anlegen und GitHub verbinden.
2. „New Web Service“ wählen und dieses Repository auswählen.
3. Region: **Frankfurt (EU Central)**, also dieselbe Region wie Turso. Sonst dauert jeder Tipp fast 1 Sekunde.
4. Build Command: `npm ci`. Start Command: `npm start`. Instance Type: Free.
5. Variablen setzen: `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SECURE_COOKIES=true`, optional `REGISTRATION_CODE`.
6. Render gibt dir eine HTTPS-Adresse, z. B. `https://getraenke.onrender.com`.

**Grenzen des Gratis-Tarifs**

- Render schläft nach 15 Minuten ohne Besucher. Der erste Aufruf danach dauert bis zu 1 Minute.
- Öffne die App also kurz vor der Feier einmal selbst.
- Die Daten bleiben trotzdem erhalten, denn sie liegen bei Turso.

## Weitere Hosting-Optionen

Alle Optionen funktionieren auch mit Turso. Dann setzt du `DATABASE_URL` und `DATABASE_AUTH_TOKEN` und brauchst kein Volume.
Ohne Turso braucht die App einen Server mit **dauerhaftem Speicher** für die Datenbank-Datei.

| Option | Kosten (ca.) | Aufwand | Für wen |
|---|---|---|---|
| **A. Railway oder Fly.io** | ca. 5 $/Monat | gering | Schnell online, ohne Server-Wissen |
| **B. Hetzner Cloud VPS** | ca. 4–6 €/Monat | mittel | Dauerhaft, günstig, Server in Deutschland (DSGVO) |
| **C. Eigener Rechner + Cloudflare Tunnel** | 0 € | mittel | Einmalige Feier, Rechner läuft vor Ort |

**Empfehlung:** Für den Start die Gratis-Option Turso + Render. Ohne Wartezeit nach Pausen Option A. Für dauerhaften Betrieb in Deutschland Option B.

### A. Railway oder Fly.io

1. Repository mit dem Anbieter verbinden. Der Anbieter baut das `Dockerfile` automatisch.
2. Ein **Volume** anlegen und unter `/data` einhängen. Mit Turso entfällt dieser Schritt.
3. Variablen setzen: `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SECURE_COOKIES=true`, optional `REGISTRATION_CODE`.
4. Der Anbieter gibt dir eine HTTPS-Adresse. Diese Adresse teilst du mit den Gästen.

### B. Hetzner Cloud VPS mit Docker

1. Server mit Ubuntu anlegen. Docker installieren.
2. Eine Domain auf die IP des Servers zeigen lassen (A-Record).
3. Auf dem Server:

```bash
git clone https://github.com/zImLenny/Getraenke-APP.git && cd Getraenke-APP
```

```bash
cp .env.example .env && nano .env
```

```bash
docker compose up -d --build
```

Caddy holt automatisch ein HTTPS-Zertifikat für die Domain aus `.env`.

### C. Eigener Rechner + Cloudflare Tunnel

1. App lokal starten (siehe oben).
2. `cloudflared tunnel --url http://localhost:3000` ausführen.
3. Cloudflare gibt dir eine öffentliche HTTPS-Adresse.

Nachteil: Der Rechner muss die ganze Zeit laufen und Internet haben.

## App aufs Telefon bringen

Die App ist eine Web-App (PWA). Du brauchst keinen App Store und keinen eigenen Build.

**Android (Chrome)**

1. Die Adresse der App öffnen.
2. Menü ⋮ antippen.
3. „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen.

**iPhone (Safari)**

1. Die Adresse der App in Safari öffnen.
2. Teilen-Knopf antippen.
3. „Zum Home-Bildschirm“ wählen.

Danach startet die App wie eine normale App, ohne Browser-Leiste.

## Ablauf einer Feier

1. Admin → Tab **Getränke**: Getränke mit Preis anlegen.
2. Admin → Tab **Event**: Namen eingeben, **Event starten**.
3. Gäste registrieren sich. Du gibst sie im Tab **Personen** frei. Dann tippen sie bei jedem Getränk auf **+**.
4. Am Ende: Admin → Tab **Event** → **Event beenden** → Zahlungsdaten eintragen → **Fertig**.
5. Die Gäste sehen ihre Abrechnung und bezahlen per Überweisung oder PayPal.

## Tipp für die Veranstaltung

Drucke einen QR-Code mit der Adresse der App und dem Einladungscode aus.
Gäste scannen ihn und registrieren sich in 30 Sekunden.

## Technik

- Server: Node.js 20+, Express 5, SQLite über `@libsql/client` (lokal als Datei oder bei Turso)
- Oberfläche: HTML, CSS und JavaScript ohne Framework
- QR-Code: EPC-Standard (GiroCode), erzeugt mit `qrcode` auf dem Server. Die App prüft die IBAN-Prüfziffer.
- Passwörter: scrypt-Hash. Sitzungen: zufälliges Token im HttpOnly-Cookie, 30 Tage gültig.
- Login-Schutz: Nach 10 Fehlversuchen in 15 Minuten sperrt die App den Login für diese IP und diesen Benutzernamen.
- Registrier-Bremse: Höchstens 30 neue Konten pro IP in 15 Minuten. Gäste im selben WLAN teilen sich eine IP.
- Ein neues Passwort durch den Admin beendet alle Sitzungen der Person.
- Der CSV-Export entschärft Namen, die mit `=`, `+`, `-` oder `@` beginnen. Excel führt sie dann nicht als Formel aus.
- Tests: `npm test` startet die App mit einer Datenbank im Arbeitsspeicher.

## Ideen für später

- Guthaben aufladen
- QR-Code direkt in der App erzeugen
- Statistik nach Uhrzeit
