# AGENTS.md – D&D Dashboard

Diese Datei beschreibt das Projekt, wichtige Konventionen und Arbeitsregeln für
Assistenten/Entwickler. **Letzte Aktualisierung:** 2026-07-14.

## Projektübersicht

D&D Dashboard ist eine webbasierte Anwendung mit einem gemeinsamen,
passwortgeschützten Bingo-Modus.

- **Frontend:** React, Vite, TypeScript, Tailwind CSS
- **Backend:** Node.js, Express, SQLite (better-sqlite3), Socket.io
- **Auth:** JWT (Cookie + Auth-Header), bcrypt, Discord OAuth2
- **Echtzeit:** Socket.io
- **Module-System:** ESM (`"type": "module"` in `package.json`)

## Wichtige Befehle

```bash
npm install              # Abhängigkeiten installieren
npm run dev              # Server + Client im Dev-Modus (concurrently)
npm run server           # Server mit tsx (einmalig)
npm run server:watch     # Server mit tsx und Node --watch
npm run client           # Nur Vite-Dev-Server
npm run build            # Client (tsc + vite build) + Server (tsc -p tsconfig.server.json)
npm run build:server     # Nur Server bauen
npm run build:version    # Schreibt `dist-server/version.json` aus der Git-Commit-Anzahl
npm run start            # Produktionsserver (erfordert vorherigen Build)
npm run preview          # Vite-Production-Preview
npm run test:server      # Server mit separater Test-DB starten
npx oxlint               # Optional: Oxlint manuell ausführen
```

**Dev-URLs:**

- Client: `http://localhost:5173`
- Server: `http://localhost:3001`
- Vite proxied `/api` und `/socket.io` an den Server.

## Architektur

- `server/index.ts` – Express- und Socket.io-Setup, Router-Mounting, Shutdown-Handler
- `server/auth.ts` – JWT-Erstellung, -Validierung, Auth-Middleware, Admin-Middleware
- `server/database.ts` – Zentrale SQLite-Verbindung
- `server/users.ts` – SQLite-Benutzerverwaltung, Passwort-Hashing, Account-Lockout
- `server/repositories/games.ts` – SQLite-Spielstand-Speicherung (JSON in `games`-Tabelle)
- `server/game.ts` – Bingo-Spiel-Logik, Persistenz, Bingo-Prüfung
- `server/routes/auth.ts` – Auth-/Login-/State-API-Routen
- `server/routes/admin.ts` – Admin-API-Routen
- `server/socket.ts` – Socket.io-Event-Handler
- `server/version.ts` – Liest die aktuelle Git-Commit-Nummer aus
- `shared/types.ts` – Gemeinsame TypeScript-Typen für Frontend und Backend
- `src/App.tsx` – React-App-Einstieg mit Router
- `src/hooks/useAuth.ts` – Auth-Hook (Login, Token, /api/me)
- `src/hooks/useSocket.ts` – Socket.io-Hook
- `src/hooks/useApi.ts` – `fetch`-Wrapper mit automatischer Fehler-Toast-Anzeige
- `src/hooks/useError.ts` – Zugriff auf den globalen Fehler-Context
- `src/contexts/ErrorContext.ts` / `ErrorProvider.tsx` – Globaler Fehler-/Toast-Context
- `src/pages/` – Seiten: Login, AdminLogin, AuthCallback, Home, Bingo, Admin
- `src/components/` – Wiederverwendbare Komponenten (Layout, ProtectedRoute, ConfirmDialog, Toast)
- `src/types.ts` – Frontend-Typ-Alias für den Socket.io-Client
- `vite.config.ts` – Vite-Konfiguration mit Proxy und Tailwind

## Wichtige Konventionen

- TypeScript strict ist aktiv (`strict: true` in allen tsconfigs).
- Client-Code liegt in `src/`, Server-Code in `server/`, geteilte Typen in `shared/`.
- Imports im Server-Code verwenden `.js`-Suffixe (ESM / NodeNext).
- Client-Imports verwenden kein `.js`-Suffix und können `.ts`/`.tsx` direkt importieren.
- `tsconfig.json` enthält nur Projekt-Referenzen (`tsconfig.app.json`, `tsconfig.node.json`).
- `tsconfig.server.json` baut `server/` und `shared/` nach `dist-server/`.
- `scripts/buildVersion.ts` generiert `dist-server/version.json` mit `mainVersion`, `currentVersion`, `branch` und `ahead`.
- `server/version.ts` ermittelt zur Laufzeit über Git `mainVersion` (letzter `main`-Stand), `currentVersion`, `branch` und `ahead` (Commits vor `main`); falls Git nicht verfügbar ist, wird auf `dist-server/version.json` zurückgegriffen.
- Das SQLite-Handle wird in `server/database.ts` zentral geöffnet und von `server/users.ts` und `server/repositories/games.ts` verwendet.
- `dnd.db` und `dnd_test.db` sind `.gitignore`d und werden automatisch erstellt.
- Umgebungsvariablen werden über `dotenv` aus `.env` geladen.
- In Produktion liefert Express `dist/` aus und `trust proxy` ist aktiviert.

## .env / Umgebungsvariablen

Kopiere `.env.example` nach `.env` und passe Werte an:

```bash
PORT=3001
JWT_SECRET=änder-dich-in-produktion
ADMIN_PASSWORD=dein-sehr-sicheres-passwort
DISCORD_CLIENT_ID=deine-client-id
DISCORD_CLIENT_SECRET=dein-client-secret
DISCORD_REDIRECT_URI=http://localhost:5173/auth/discord
```

- `PORT` ist optional, Standard ist `3001`.
- `JWT_SECRET` muss gesetzt sein, sonst startet der Server nicht.
- `ADMIN_PASSWORD` muss gesetzt sein, sonst startet der Server nicht.
- `DISCORD_*` müssen für Discord-Login konfiguriert sein.
- Optional: `VITE_SERVER_URL` für den Socket.io-Client im Frontend.
- Optional: `DB_PATH=dnd_test.db` für Tests oder eine separate Datenbank.
- Optional: `NODE_ENV=production` aktiviert statisches Serving von `dist/`.

## Sicherheitshinweise

- Geheime Werte (`JWT_SECRET`, `ADMIN_PASSWORD`, `DISCORD_CLIENT_SECRET`) gehören in `.env` und dürfen **niemals** committed werden.
- `.env`, `*.db`, `dist/` und `dist-server/` sind in `.gitignore`.
- Der Admin-Username `admin` ist gegen Löschen, Sperren und Admin-Entzug geschützt.
- Admins können sich selbst nicht verändern.
- Login und Admin-Login haben IP-basiertes Rate-Limiting (15 Minuten, max. 10 POST-Requests).
- Nach 5 fehlgeschlagenen Login-Versuchen wird ein Account für 15 Minuten gesperrt.
- Passwörter werden mit `bcrypt` gehasht.
- JWT wird als `httpOnly`-Cookie und optional als Bearer-Token akzeptiert.
- Socket.io verwendet denselben Token wie die API (`auth: { token }` bzw. Cookie).
- `app.set('trust proxy', 1)` ist aktiv, damit Rate-Limiting hinter einem Reverse-Proxy korrekt funktioniert.

## Admin & Benutzer-Regeln

- Beim ersten Start wird ein Default-Admin `admin` mit dem Passwort aus
  `ADMIN_PASSWORD` erstellt.
- Neue Discord-Benutzer müssen von einem Admin freigegeben werden, bevor sie
  sich einloggen können.
- Der Admin-Login ist über ein Easter Egg auf der Login-Seite erreichbar: 5x auf den Titel klicken.
- Ursprünglicher Admin (`admin`) ist der einzige, der `/admin-login` benötigt;
  promoted Admins verwenden den normalen Discord-Login.
- Promoted Admins können wie normale Spieler am Bingo teilnehmen.
- Der Ursprungsadmin `admin` darf Bingo nicht als Spieler beitreten.
- Admins können Spieler freigeben/sperren, Admin-Rechte vergeben/entziehen und Benutzer löschen.

## Bingo-Spielablauf

1. **Setup-Phase:** Admins fügen Aufgaben hinzu und wählen die Feldgröße (3–5).
2. **Beitreten:** Spieler betreten über `join` mit ihrem Discord-Anzeigenamen.
3. **Brett füllen:** Jeder Spieler zieht Aufgaben aus dem Pool auf sein Brett.
4. **Einlocken:** Sobald das Brett vollständig ist, sperrt der Spieler es.
5. **Start:** Admin startet das Spiel, sobald alle Online-Spieler eingelockt haben
   und genug Aufgaben vorhanden sind (`gridSize * gridSize`).
6. **Spiel:** Aufgaben werden global bestätigt (`confirmTask` / `confirmTaskFor`);
   erledigte Aufgaben werden in allen Brettern markiert.
7. **Bingo:** Sobald eine Zeile, Spalte oder Diagonale vollständig bestätigt ist,
   gewinnt der Spieler. Es wird ein `bingo`-Event mit dem Namen ausgesendet.
8. **Neue Runde:** Admin kann das Spiel beenden und zurücksetzen (`resetGame`);
   Aufgaben bleiben erhalten, Bretter werden geleert.

## Wichtige Socket.io-Events

**Server → Client (`ServerToClientEvents`):**

- `state` – aktueller `BingoGame`-Zustand
- `error` – Fehlermeldung für den Client
- `joined` – eigene `playerId` nach `join`
- `bingo` – ein Spieler hat Bingo (`playerName`)

**Client → Server (`ClientToServerEvents`):**

- `join` – Spiel beitreten
- `addTask` / `removeTask` – Aufgaben verwalten
- `setGridSize` – Feldgröße ändern (Admin, nur Setup)
- `startGame` – Spiel starten (Admin, nur Setup)
- `updateBoard` / `lockBoard` / `unlockBoard` – Brett bearbeiten
- `confirmTask` / `unconfirmTask` – Aufgaben bestätigen/zurücksetzen
- `confirmTaskFor` – Aufgabe für anderen Spieler bestätigen (z. B. Admin)
- `resetGame` – Spiel beenden und zurücksetzen (Admin)

## Bekannte Edge Cases

- Neue Benutzer müssen von einem Admin freigegeben werden, bevor sie sich einloggen können.
- Der Bingo-Name kommt automatisch vom Account-Anzeigenamen (`displayName`).
- Änderungen am Anzeigenamen werden bei erneutem Discord-Login über
  `updateDiscordProfile` in `server/users.ts` aktualisiert. Ein separates
  Profil-Update (`PUT /api/me`) ist aktuell nicht implementiert.
- `Ctrl+C` in `npm run dev` beendet beide Prozesse; bei hängenden Prozessen
  helfen `lsof -i :3001` / `lsof -i :5173` und `kill -9 <PID>`.
- Ein abgelehnter (`isApproved = false`) Discord-User kann nach der Freigabe
  erneut einloggen, ohne neu angelegt zu werden.
- `ensureAdminUser()` startet nicht, wenn `ADMIN_PASSWORD` fehlt.

## Dateien, die nicht verändert werden sollten

- `.gitignore` enthält sensible Dateien (`.env`, `*.db`, `dist`, `dist-server`).
- `server/users.ts` enthält `INITIAL_ADMIN_USERNAME` und liest `ADMIN_PASSWORD` aus `.env`.
- Sicherheitsrelevante Konfigurationen (`rateLimit`, `JWT_SECRET`, `ADMIN_PASSWORD`,
  `trust proxy`) sollten nicht gelockert werden.

## Entwicklungs- & Git-Workflow (Regeln für Assistenten)

- **Keine Commits ohne ausdrückliche Genehmigung des Nutzers.**
- **Kein Push ohne ausdrückliche Genehmigung des Nutzers.**
- **Kein Force-Push, keine Branch-Löschungen und keine History-Rewrites ohne Genehmigung.**
- Vor jedem genehmigten Commit `git diff` prüfen.
- Nie `.env`, Datenbanken (`*.db`), Secrets oder Build-Artefakte (`dist/`,
  `dist-server/`) committen.
- Änderungen nicht eigenmächtig in `main` auf Produktions-Umgebungen pushen.
- Bei Unsicherheit vor dem Commit / Push beim Nutzer nachfragen.
- Nach Abschluss einer Aufgabe kurze Zusammenfassung der Änderungen geben.
