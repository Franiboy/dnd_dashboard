# D&D Dashboard

Web-basiertes Dashboard für Dungeons & Dragons mit einem gemeinsamen, passwortgeschützten Bingo-Modus.

## Features

- Benutzerregistrierung mit Admin-Freigabe
- JWT-Authentifizierung über Cookie und Auth-Header
- Admin-Panel zur Benutzerverwaltung
- Profilseite zum Ändern des Anzeigenamens
- Echtzeit-Bingo mit Socket.io
- Gemeinsamer Aufgaben-Pool
- Spieler-Liste und History
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

## Default Admin

Beim ersten Start wird ein Admin-Account erstellt:

- Username: `admin`
- Passwort: `Schoengleina4812!`

Der Admin kann über das Admin-Panel neue Benutzer freigeben, weitere Admins ernennen und Benutzer löschen.

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

- `server/index.ts` – Express- und Socket.io-Setup
- `server/users.ts` – Benutzerdatenbank und Authentifizierung
- `server/game.ts` – Bingo-Spiel-Logik
- `shared/types.ts` – Gemeinsame TypeScript-Typen
- `src/App.tsx` – React-App-Einstieg
- `src/hooks/useSocket.ts` – Auth- und Socket-Hooks
