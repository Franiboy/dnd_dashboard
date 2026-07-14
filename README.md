# D&D Dashboard

Web-basiertes Dashboard für Dungeons & Dragons mit einem gemeinsamen, passwortgeschützten Bingo-Modus.

## Features

- Discord OAuth2 Login
- Admin-Freigabe für neue Discord-Benutzer
- JWT-Authentifizierung über Cookie und Auth-Header
- Admin-Panel zur Benutzerverwaltung (Freigabe, Sperren, Admin-Rechte, Löschen)
- Admin-Login über Easter Egg (5x auf den Titel klicken)
- Echtzeit-Bingo mit Socket.io (Spielstart, Feldgröße, Reset)
- Gemeinsamer Aufgaben-Pool
- Spieler-Liste
- Brute-Force-Schutz durch Rate-Limiting und Account-Lockout

## Tech Stack

- **Backend:** Node.js, Express, SQLite (better-sqlite3), Socket.io
- **Frontend:** React, Vite, TypeScript, Tailwind CSS
- **Echtzeit:** Socket.io
- **Auth:** JWT, bcrypt

## Voraussetzungen

- Node.js >= 22
- npm

## Installation

```bash
npm install
```

## Entwicklung

Starte Server und Client gemeinsam:

```bash
npm run dev
```

- Client läuft auf http://localhost:5173
- Server läuft auf http://localhost:3001

Einzeln starten:

```bash
npm run server
npm run client
```

## Build

```bash
npm run build
```

Erzeugt `dist/` (Client) und `dist-server/` (Server).

## Produktion

```bash
npm run build
npm start
```

Der Server liefert dann `dist/` aus und ist auf dem in `PORT` konfigurierten Port erreichbar (Standard 3001).

## Discord OAuth2

Für den Discord Login musst du eine Anwendung im [Discord Developer Portal](https://discord.com/developers/applications) erstellen und folgende Werte in `.env` eintragen:

```bash
DISCORD_CLIENT_ID=deine-client-id
DISCORD_CLIENT_SECRET=dein-client-secret
DISCORD_REDIRECT_URI=http://localhost:5173/auth/discord
```

Füge unter `OAuth2 → Redirects` die URL `http://localhost:5173/auth/discord` hinzu.

## Default Admin

Beim ersten Start wird ein Admin-Account erstellt. Das Passwort wird aus der Umgebungsvariablen `ADMIN_PASSWORD` gelesen. Kopiere `.env.example` nach `.env` und setze ein sicheres Passwort:

```bash
cp .env.example .env
# .env editieren: ADMIN_PASSWORD=dein-sicheres-passwort
```

- Username: `admin`
- Passwort: Wert aus `ADMIN_PASSWORD` in `.env`

Der Default Admin kann über ein Easter Egg erreicht werden: Auf der Login-Seite 5 Mal auf den Titel klicken, dann erscheint der Admin Login Link. Der Admin kann im Admin-Panel nur noch Benutzer freigeben, löschen und Admin-Rechte vergeben. Normale Registrierung entfällt, da jeder Benutzer über Discord kommt.

## Datenbank

Die SQLite-Datenbank wird als `dnd.db` im Projektroot angelegt. Sie enthält Benutzer- und Spieldaten und ist in `.gitignore` eingetragen.

Für Tests kann eine separate Datenbank verwendet werden:

```bash
DB_PATH=dnd_test.db npm run server
```

## Test

```bash
npm run test:server
# In einem zweiten Terminal
npm run test
```

## Wichtige Dateien

- `server/index.ts` – Express- und Socket.io-Setup, API-Routen
- `server/auth.ts` – JWT-Handling und Middleware
- `server/users.ts` – Benutzerdatenbank und Authentifizierung
- `server/db.ts` – SQLite-Spielstand-Speicherung
- `server/game.ts` – Bingo-Spiel-Logik
- `shared/types.ts` – Gemeinsame TypeScript-Typen
- `src/App.tsx` – React-App-Einstieg
- `src/hooks/useAuth.ts` – Auth-Hook
- `src/hooks/useSocket.ts` – Socket.io-Hook
