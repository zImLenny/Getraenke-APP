# Getränke-Zähler

Web-App für Veranstaltungen. Jeder Gast zählt seine Getränke selbst auf dem Handy.
Der Admin sieht, wer was getrunken hat, und korrigiert Fehler.

## Funktionen

**Gäste**
- Registrieren und anmelden (Benutzername + Passwort, optional mit Einladungscode).
- Für jedes Getränk einen großen **+**-Knopf. Es gibt **kein Minus**.
- Eigene Anzahl und eigene Summe in Euro sehen.
- Schutz gegen Doppel-Tipp (0,8 Sekunden).
- Läuft im Browser. Gäste können die Seite zum Startbildschirm hinzufügen (PWA).

**Admin**
- Übersicht: Tabelle Person × Getränk mit **+** und **−**. Aktualisiert sich alle 5 Sekunden.
- Summen pro Person, pro Getränk und gesamt.
- Getränke anlegen, umbenennen, Preis ändern, deaktivieren, löschen.
- Preisänderungen gelten nur für neue Buchungen.
- Personen verwalten: Admin-Rechte geben, Passwort neu setzen, löschen.
- Protokoll: jede Buchung mit Uhrzeit. Ein Minus löscht nichts, es markiert die Buchung.
- CSV-Export für Excel.

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
3. Build Command: `npm ci`. Start Command: `npm start`. Instance Type: Free.
4. Variablen setzen: `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SECURE_COOKIES=true`, optional `REGISTRATION_CODE`.
5. Render gibt dir eine HTTPS-Adresse, z. B. `https://getraenke.onrender.com`.

**Grenzen des Gratis-Tarifs**

- Render schläft nach 15 Minuten ohne Besucher. Der erste Aufruf danach dauert bis zu 1 Minute.
- Öffne die App also kurz vor der Feier einmal selbst.
- Die Daten bleiben trotzdem erhalten, denn sie liegen bei Turso.

## Weitere Hosting-Optionen

Ohne Turso braucht die App einen Server mit **dauerhaftem Speicher** für die Datenbank-Datei.

| Option | Kosten (ca.) | Aufwand | Für wen |
|---|---|---|---|
| **A. Railway oder Fly.io** | ca. 5 $/Monat | gering | Schnell online, ohne Server-Wissen |
| **B. Hetzner Cloud VPS** | ca. 4–6 €/Monat | mittel | Dauerhaft, günstig, Server in Deutschland (DSGVO) |
| **C. Eigener Rechner + Cloudflare Tunnel** | 0 € | mittel | Einmalige Feier, Rechner läuft vor Ort |

**Empfehlung:** Für den Start Option A. Für dauerhaften Betrieb und mehr Funktionen Option B.

### A. Railway oder Fly.io

1. Repository mit dem Anbieter verbinden. Der Anbieter baut das `Dockerfile` automatisch.
2. Ein **Volume** anlegen und unter `/data` einhängen.
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

## Tipp für die Veranstaltung

Drucke einen QR-Code mit der Adresse der App und dem Einladungscode aus.
Gäste scannen ihn und registrieren sich in 30 Sekunden.

## Technik

- Server: Node.js, Express, SQLite über `@libsql/client` (lokal als Datei oder bei Turso)
- Oberfläche: HTML, CSS und JavaScript ohne Framework
- Passwörter: scrypt-Hash. Sitzungen: zufälliges Token im HttpOnly-Cookie.

## Ideen für später

- Mehrere Veranstaltungen getrennt verwalten
- Abrechnung: „bezahlt“ markieren, Guthaben aufladen
- QR-Code direkt in der App erzeugen
- Statistik nach Uhrzeit
