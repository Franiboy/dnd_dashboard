# AGENTS.md – D&D Dashboard

## Projektübersicht

D&D Dashboard ist eine webbasierte Anwendung mit einem gemeinsamen, passwortgeschützten Bingo-Modus.

- **Frontend:** React, Vite, TypeScript, Tailwind CSS
- **Backend:** Node.js, Express, SQLite (better-sqlite3), Socket.io
- **Auth:** JWT (Cookie + Auth-Header), bcrypt
- **Echtzeit:** Socket.io

## Wichtige Befehle

```bash
npm install        # Abhängigkeiten installieren
npm run dev        # Server + Client im Dev-Modus
npm run server     # Nur Server (node --watch)
npm run client     # Nur Client (Vite)
npm run build      # Client + Server bauen
npm run build:server  # Nur Server bauen
npm start          # Produktionsserver (erfordert vorherigen Build)
```

## Architektur

- `server/index.ts` – Express- und Socket.io-Setup, API-Routen
- `server/users.ts` – SQLite-Benutzerverwaltung und Auth-Logik
- `server/db.ts` – SQLite-Spielstand-Speicherung
- `server/game.ts` – Bingo-Spiel-Logik
- `shared/types.ts` – Gemeinsame TypeScript-Typen für Frontend und Backend
- `src/App.tsx` – React-App-Einstieg mit Router
- `src/hooks/useSocket.ts` – `useAuth` und `useSocket` Hooks
- `src/pages/` – Seiten: Login, Register, Home, Bingo, Admin, Profile
- `src/components/` – Wiederverwendbare Komponenten

## Wichtige Konventionen

- TypeScript strict ist aktiv.
- Server-Code liegt in `server/`, geteilte Typen in `shared/`.
- Imports auf dem Server verwenden `.js` Suffixe (ESM).
- Das SQLite-Handle wird in `server/users.ts` und `server/db.ts` jeweils separat geöffnet.
- `dnd.db` ist `.gitignore`d und wird automatisch erstellt.
- Für Tests kann `DB_PATH=dnd_test.db` gesetzt werden.

## Sicherheitshinweise

- Default-Admin: `admin` / `***REMOVED***`
- Der Admin-Username `admin` ist gegen Löschen, Sperren und Admin-Entzug geschützt.
- Admins können sich selbst nicht verändern.
- Login und Registrierung haben IP-basiertes Rate-Limiting.
- Nach 5 fehlgeschlagenen Login-Versuchen wird ein Account für 15 Minuten gesperrt.
- Geheime Werte (JWT_SECRET, Admin-Passwort) gehören in `.env` und dürfen nicht committed werden.

## Bekannte Edge Cases

- Neue Benutzer müssen von einem Admin freigegeben werden, bevor sie sich einloggen können.
- Der Bingo-Name kommt automatisch vom Account-Anzeigenamen.
- Änderungen am Anzeigenamen werden über `PUT /api/me` persistiert.
- `Ctrl+C` in `npm run dev` beendet beide Prozesse; bei hängenden Prozessen kann `lsof -i :3001` und `kill -9 <PID>` helfen.

## Dateien, die nicht verändert werden sollten

- `.gitignore` enthält sensible Dateien (`.env`, `*.db`, `dist`, `dist-server`).
- `server/users.ts` enthält `INITIAL_ADMIN_USERNAME` und `INITIAL_ADMIN_PASSWORD`.
