# AGENTS.md – D&D Dashboard

Diese Datei beschreibt das Projekt, wichtige Konventionen und Arbeitsregeln für
Assistenten/Entwickler. **Letzte Aktualisierung:** 2026-07-29.

## Kritische Arbeitsregeln für Assistenten

Diese Regeln gelten vor jeder Code-Änderung und haben Vorrang.

- **Jede Änderung in einem separaten Git Worktree auf einem eigenen Branch entwickeln.**
  Nicht direkt in `main` arbeiten. Einen Worktree mit
  `git worktree add <pfad> -b <branch-name>` anlegen, darin entwickeln und committen;
  nach ausdrücklicher Bestätigung des Nutzers den Branch in `main` mergen und den
  Worktree entfernen.
- **Keine Commits ohne ausdrückliche Genehmigung des Nutzers.**
- **Kein Push ohne ausdrückliche Genehmigung des Nutzers.**
- **Kein Force-Push, keine Branch-Löschungen und keine History-Rewrites ohne Genehmigung.**
- Vor jedem genehmigten Commit `git diff` prüfen.
- Nie `.env`, Datenbanken (`*.db`), Secrets oder Build-Artefakte (`dist/`,
  `dist-server/`) committen.
- Änderungen nicht eigenmächtig in `main` auf Produktions-Umgebungen pushen.
- Bei Unsicherheit vor dem Commit / Push beim Nutzer nachfragen.
- Nach Abschluss einer Aufgabe kurze Zusammenfassung der Änderungen geben.

## Projektübersicht

D&D Dashboard ist eine webbasierte Anwendung für Dungeons & Dragons-Sessions mit
mehreren Modulen:

- **Bingo:** Gemeinsamer, passwortgeschützter Echtzeit-Bingo-Modus.
- **Tagebuch & Welt:** Tagebucheinträge mit KI-gestütztem Umschreiben,
  Zusammenfassen, Entitätsextraktion und einem Wissensgraphen für Personen,
  Organisationen und Orte.
- **Aufnahmen:** Discord-Bot-basierte Sprachaufzeichnungen mit Whisper-Transkription.
- **Admin:** Benutzerverwaltung, App-Freigaben und Live-Logs.

### Tech Stack

- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS 4, Socket.io-Client
- **Backend:** Node.js 22+, Express 5, SQLite (better-sqlite3), Socket.io
- **Auth:** JWT (`httpOnly`-Cookie + Bearer-Header), bcrypt, Discord OAuth2
- **KI/MCP:** OpenCode-CLI, `@modelcontextprotocol/sdk`, eigener MCP-Server mit
  dynamischen Scopes (`server/mcp/`)
- **Discord:** `discord.js` + `@discordjs/voice` für Sprachaufzeichnungen
- **Echtzeit:** Socket.io (Bingo), SSE (Admin-Users, Admin-Logs)
- **Module-System:** ESM (`"type": "module"` in `package.json`)

## Wichtige Befehle

```bash
npm install              # Abhängigkeiten installieren
npm run dev              # Server + Client im Dev-Modus (concurrently)
npm run server           # Server mit tsx (einmalig)
npm run server:watch     # Server mit tsx und Node --watch
npm run client           # Nur Vite-Dev-Server
npm run build            # Client (tsc + vite build) + Server + version.json
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

### Server

| Datei | Zweck |
|-------|-------|
| `server/index.ts` | Express- und Socket.io-Setup, Router-Mounting, Shutdown-Handler, Start der Scheduler/Bot |
| `server/auth.ts` | JWT-Erstellung, -Validierung, Auth-Middleware, Admin-Middleware, Rate-Limiting |
| `server/database.ts` | Zentrale `better-sqlite3`-Verbindung (`dnd.db`) mit WAL und Foreign Keys |
| `server/users.ts` | SQLite-Benutzerverwaltung, Passwort-Hashing, Account-Lockout, Discord-Profil-Updates |
| `server/migrations.ts` | Datenbank-Schema-Migrationen beim Start |
| `server/logger.ts` | Zentraler, kategorisierter Logger mit In-Memory-Buffer und SSE-Subscription |
| `server/version.ts` | Liefert aktivierte Feature-Flags (`aiEnabled`, `recordingEnabled`) |
| `server/socket.ts` | Socket.io-Event-Handler für das Bingo |
| `server/diaryFiles.ts` | Speichert KI-Rewrites als Dateien unter `rewritten/` |

### Routes (`server/routes/`)

| Datei | Zweck |
|-------|-------|
| `auth.ts` | Login, Discord-Callback, `/me`, Logout |
| `admin.ts` | Admin-API, SSE `/admin/users/events`, SSE `/admin/logs/events`, paginiertes `/admin/logs` |
| `ai.ts` | `POST /api/execute` – direkte Ausführung von KI-Tool-Aktionen (nur Admin / Debug) |
| `diary.ts` | CRUD für Tagebucheinträge, KI-Rewrite, Zusammenfassung, Entitäten; SSE für KI-Status |
| `entities.ts` | Entitätsliste, Details, Aliase, Blacklist, Wissens- und Zusammenfassungs-CRUD |
| `recordings.ts` | Discord-Aufnahme-Sessions, Transkripte, Trimming |

### Repositories (`server/repositories/`)

| Datei | Zweck |
|-------|-------|
| `games.ts` | SQLite-Spielstand-Speicherung (JSON in `games`-Tabelle) |
| `diary.ts` | Tagebucheinträge, Entitäten, Aliase, Suche, Kanonische Namensauflösung |
| `entityKnowledge.ts` | Wissenseinträge zu Entitäten (CRUD, soft-delete) |
| `entitySummaries.ts` | KI-generierte Entitäts-Zusammenfassungen |
| `recordings.ts` | Aufnahme-Sessions und Dateien |

### KI / MCP (`server/ai/` & `server/mcp/`)

| Datei | Zweck |
|-------|-------|
| `ai/config.ts` | Prüft, ob die KI aktiviert ist (`AI_PROVIDER=opencode` + gültiges `AI_MODEL`) |
| `ai/opencode.ts` | Spawnt `opencode run` mit MCP-Token und Scopes |
| `ai/rewrite.ts` | Prompts für Rewrite, Zusammenfassung und Entitätsextraktion |
| `ai/knowledge.ts` | Prompts für Wissensverteilung und Entitäts-Zusammenfassungen |
| `ai/actions.ts` | Parser und Executor für direkte KI-Tool-Aktionen |
| `mcp/index.ts` | MCP-Server mit Tools (`set_diary_*`, `get_entity`, `create_knowledge`, …) |
| `mcp/tokens.ts` | JWT-basierte MCP-Session-Tokens mit Scopes |

### Scheduler & Discord (`server/scheduler/` & `server/discord/`)

| Datei | Zweck |
|-------|-------|
| `scheduler/entitySummaries.ts` | Startet KI-generierte Entitäts-Zusammenfassungen im Hintergrund |
| `discord/bot.ts` | Startet den Discord-Bot und joint Voice-Channels für Aufnahmen |
| `discord/recorder.ts` | Nimmt Discord-Audio auf und speichert PCM-Dateien |
| `discord/transcriber.ts` | Führt Whisper-Transkription aus |
| `discord/scheduler.ts` | Verarbeitet anstehende Transkriptionen |
| `discord/audio.ts` / `files.ts` / `recordingsEvents.ts` | Audio-Verarbeitung, Dateiverwaltung, Events |

### Frontend (`src/`)

| Datei / Verzeichnis | Zweck |
|---------------------|-------|
| `src/App.tsx` | React-App-Einstieg mit Router |
| `src/main.tsx` | Root-Render |
| `src/lib/apps.ts` | App-Metadaten (Dashboard, Tagebuch, Bingo, Welt, Aufnahmen, Admin) |
| `src/pages/` | Seiten: Login, AdminLogin, AuthCallback, Home, Bingo, Diary, World, Recordings, Admin |
| `src/components/` | Wiederverwendbare Komponenten (Layout, ProtectedRoute, ConfirmDialog, Toast, LogPanel, …) |
| `src/hooks/useAuth.ts` | Auth-Hook |
| `src/hooks/useSocket.ts` | Socket.io-Hook |
| `src/hooks/useApi.ts` | `fetch`-Wrapper mit automatischer Fehler-Toast-Anzeige |
| `src/hooks/useError.ts` | Zugriff auf den globalen Fehler-Context |
| `src/contexts/ErrorContext.ts` / `ErrorProvider.tsx` | Globaler Fehler-/Toast-Context |
| `src/types.ts` | Frontend-Typ-Alias für den Socket.io-Client |

### Shared

- `shared/types.ts` – Gemeinsame TypeScript-Typen für Frontend und Backend.

## Wichtige Konventionen

- TypeScript strict ist aktiv (`strict: true` in allen tsconfigs).
- Client-Code liegt in `src/`, Server-Code in `server/`, geteilte Typen in `shared/`.
- Imports im Server-Code verwenden `.js`-Suffixe (ESM / NodeNext).
- Client-Imports verwenden kein `.js`-Suffix und können `.ts`/`.tsx` direkt importieren.
- `tsconfig.json` enthält nur Projekt-Referenzen (`tsconfig.app.json`, `tsconfig.node.json`).
- `tsconfig.server.json` baut `server/` und `shared/` nach `dist-server/`.
- `scripts/buildVersion.ts` generiert `dist-server/version.json` mit den aktivierten Feature-Flags.
- `scripts/copyServerAssets.ts` kopiert Nicht-TS-Dateien in `dist-server/`.
- `server/version.ts` liefert zur Laufzeit die aktivierten Feature-Flags.
- Das SQLite-Handle wird in `server/database.ts` zentral geöffnet.
- `dnd.db` und `dnd_test.db` sind `.gitignore`d und werden automatisch erstellt.
- Umgebungsvariablen werden über `dotenv` aus `.env` geladen.
- In Produktion liefert Express `dist/` aus und `trust proxy` ist aktiviert.
- Feature-Flags (`aiEnabled`, `recordingEnabled`) werden aus `.env` und `version.ts` bestimmt.
- Neue „Apps“ werden zentral in `src/lib/apps.ts` gepflegt und über die exportierte `isAppVisible()`-Hilfe in `AppSwitcher`, `Home` und `ProtectedRoute` verwendet, damit `disabledApps`, `adminOnly`, `hideForInitialAdmin` und `requiresFeature` überall konsistent geprüft werden.
- Routen, die ein Feature-Flag (`requiresFeature`) benötigen, verwenden `ProtectedRoute` mit `appId` und `version` und zeigen während des Ladens von `/api/version` einen Ladezustand an.

## .env / Umgebungsvariablen

Kopiere `.env.example` nach `.env` und passe Werte an:

```bash
PORT=3001
JWT_SECRET=änder-dich-in-produktion
ADMIN_PASSWORD=dein-sehr-sicheres-passwort
DISCORD_CLIENT_ID=deine-client-id
DISCORD_CLIENT_SECRET=dein-client-secret
DISCORD_REDIRECT_URI=http://localhost:5173/auth/discord

# Discord Bot für Sprachaufzeichnung (optional)
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
WHISPER_LANGUAGE=de
WHISPER_MODEL=base
# PYTHON_COMMAND=python3
# WHISPER_FP16=false

# AI (optional)
AI_PROVIDER=opencode
AI_MODEL=provider/GLM5.2
# AI_CHEAP_MODEL=provider/GLM5.2
# AI_OPENCODE_BIN=opencode

# CORS / Frontend-Origin (optional)
# CORS_ORIGIN=http://localhost:3001,https://example.com

# Logging (optional)
# Maximale Anzahl persistenter Log-Einträge in der SQLite-Datenbank.
# Älteste Einträge werden automatisch gelöscht, wenn das Limit überschritten wird.
# LOG_RETENTION_MAX=100000

# MCP (optional)
# MCP_TOKEN_SECRET=änder-dich-in-produktion
```

- `PORT` ist optional, Standard ist `3001`.
- `JWT_SECRET` muss gesetzt sein, sonst startet der Server nicht.
- `ADMIN_PASSWORD` muss gesetzt sein, sonst startet `ensureAdminUser()` nicht.
- `DISCORD_*` müssen für Discord-Login konfiguriert sein.
- `DISCORD_BOT_TOKEN` + `DISCORD_GUILD_ID` aktivieren den Aufnahme-Bot.
- `WHISPER_*` konfigurieren die lokale Transkription.
- `AI_PROVIDER` muss `opencode` sein und `AI_MODEL` darf keinen Platzhalter (`provider/…`) enthalten, damit KI aktiviert ist.
- `AI_CHEAP_MODEL` wird für kurze KI-Aufgaben (Zusammenfassungen, Entitäten) verwendet.
- `AI_OPENCODE_BIN` überschreibt den `opencode`-Befehl.
- `MCP_TOKEN_SECRET` defaultet zu `JWT_SECRET`.
- Optional: `CORS_ORIGIN` für erlaubte Cross-Origin-Origins (kommasepariert). Wenn nicht gesetzt, erlaubt die Entwicklungsumgebung nur `http://localhost:5173` und `http://localhost:3001`; in Produktion sind keine Cross-Origin-Anfragen erlaubt.
- Optional: `VITE_SERVER_URL` für den Socket.io-Client im Frontend.
- Optional: `DB_PATH=dnd_test.db` für Tests oder eine separate Datenbank.
- Optional: `NODE_ENV=production` aktiviert statisches Serving von `dist/`.
- Optional: `LOG_RETENTION_MAX` begrenzt die Anzahl persistenter Log-Einträge (Standard: 100.000).

## Sicherheitshinweise

- Geheime Werte (`JWT_SECRET`, `ADMIN_PASSWORD`, `DISCORD_CLIENT_SECRET`,
  `DISCORD_BOT_TOKEN`, `MCP_TOKEN_SECRET`) gehören in `.env` und dürfen
  **niemals** committed werden.
- `.env`, `*.db`, `dist/`, `dist-server/`, `rewritten/` und `recordings/` sind in `.gitignore`.
- Der Admin-Username `admin` ist gegen Löschen, Sperren und Admin-Entzug geschützt.
- Admins können sich selbst nicht verändern.
- Login und Admin-Login haben IP-basiertes Rate-Limiting (15 Minuten, max. 10 POST-Requests).
- Nach 5 fehlgeschlagenen Login-Versuchen wird ein Account für 15 Minuten gesperrt.
- Passwörter werden mit `bcrypt` gehasht.
- JWT wird als `httpOnly`-Cookie und optional als Bearer-Token akzeptiert.
- Socket.io verwendet denselben Token wie die API (`auth: { token }` bzw. Cookie).
- `app.set('trust proxy', 1)` ist aktiv, damit Rate-Limiting hinter einem Reverse-Proxy korrekt funktioniert.
- MCP-Session-Tokens laufen nach 10 Minuten ab und sind auf bestimmte Scopes beschränkt.

## Admin & Benutzer-Regeln

- Beim ersten Start wird ein Default-Admin `admin` mit dem Passwort aus
  `ADMIN_PASSWORD` erstellt.
- Neue Discord-Benutzer müssen von einem Admin freigegeben werden, bevor sie
  sich einloggen können.
- Der Admin-Login ist über ein Easter Egg auf der Login-Seite erreichbar: 5x auf den Titel klicken.
- Ursprünglicher Admin (`admin`) ist der einzige, der `/admin-login` benötigt;
  promoted Admins verwenden den normalen Discord-Login.
  Der Login prüft den gespeicherten Passwort-Hash und wendet das gleiche Account-Lockout wie der Discord-Login an.
- Promoted Admins können wie normale Spieler am Bingo teilnehmen.
- Der Ursprungsadmin `admin` darf Bingo nicht als Spieler beitreten.
- Admins können Spieler freigeben/sperren, Admin-Rechte vergeben/entziehen,
  Benutzer löschen und einzelne Apps pro Benutzer deaktivieren (`disabledApps`).
- `/admin` ist nur für Admins zugänglich und zeigt Benutzerverwaltung sowie Logs.
- `/bingo`, `/tagebuch`, `/welt`, `/recordings` können über `disabledApps` pro Benutzer gesperrt werden.

## App-Navigator

Die sichtbaren Apps werden zentral in `src/lib/apps.ts` gepflegt. Der Ursprungsadmin (`admin`) sieht Apps mit `hideForInitialAdmin` nicht. Das `recordings`-Modul erfordert `recordingEnabled=true` (`requiresFeature`).

| ID | Label | Route | Admin only | Disableable | Hide for initial admin | Requires feature | Icon ID |
|----|-------|-------|------------|-------------|------------------------|------------------|---------|
| `dashboard` | Dashboard | `/` | nein | nein | ja | - | - |
| `notes` | Tagebuch | `/tagebuch` | nein | ja | ja | - | - |
| `bingo` | Bingo | `/bingo` | nein | ja | ja | - | - |
| `world` | Welt | `/welt` | nein | ja | ja | - | - |
| `recordings` | Aufnahmen | `/recordings` | ja | ja | nein | `recordingEnabled` | `recordings` |
| `admin` | Admin | `/admin` | ja | nein | nein | - | `admin` |

## Bingo-Spielablauf

1. **Setup-Phase:** Admins fügen Aufgaben hinzu und wählen die Feldgröße (3–5).
   Private Aufgaben können mehreren Spielern zugewiesen werden; sie sind für
   andere Spieler und für Admins ohne den „Show Hidden“-Schalter nicht sichtbar.
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
- `addTask` – Aufgabe hinzufügen (`{ text, isPrivate?, assignedTo?: string[] }`)
- `removeTask` – Aufgabe entfernen
- `updateTask` – Aufgabe bearbeiten (`{ taskId, text?, isPrivate?, assignedTo? }`)
- `setGridSize` – Feldgröße ändern (Admin, nur Setup)
- `startGame` – Spiel starten (Admin, nur Setup)
- `updateBoard` / `lockBoard` / `unlockBoard` – Brett bearbeiten
- `confirmTask` / `unconfirmTask` – Aufgaben bestätigen/zurücksetzen
- `confirmTaskFor` – Aufgabe für anderen Spieler bestätigen (z. B. Admin)
- `resetGame` – Spiel beenden und zurücksetzen (Admin)

## Server-Sent Events (SSE)

Neben Socket.io für das Bingo werden Zustands-Updates über **Server-Sent Events** ausgeliefert.
Das Muster ist überall gleich:

1. Der Client öffnet einen `EventSource`-Stream zu einem `GET /api/.../events`-Endpunkt.
2. Der Server hält offene `Response`-Objekte in einem `SseBroadcaster` (`server/utils/sse.ts`).
3. Mutierende Endpunkte ändern den Zustand und rufen eine `notify...()`-Funktion auf,
   die den aktuellen Zustand an alle offenen Streams pusht.
4. Der Client empfängt den Zustand über `addEventListener('<event>', ...)`.
   Verbindungsabbrüche werden vom Browser automatisch wiederverbunden.

### Bestehende SSE-Endpunkte

| Endpunkt | Event | Payload | Beschreibung |
|----------|-------|---------|--------------|
| `GET /api/admin/users/events` | `users` | `SafeUser[]` | Benutzerliste (Admin) |
| `GET /api/admin/logs/events` | `logs` / `log` | `LogEntry[]` / `LogEntry` | Live-Logs (Admin) |
| `GET /api/recordings/events` | `status` / `sessions` / `progress` | Recording-Status und -Listen (Admin) |
| `GET /api/diary/ai-events` | `log` / `connected` | `{ message: string }` | KI-Fortschritt im Tagebuch |

### Konventionen für neue SSE-Streams

- Endpunkt: `GET /api/<bereich>/events`, mit `authMiddleware` und ggf. `requireAdmin` schützen.
- Header setzen: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
- Initialen Zustand sofort schreiben.
- `SseBroadcaster.add(res)` verwenden; die zurückgegebene Cleanup-Funktion auf `req.on('close')`,
  `res.on('close')` und `res.on('error')` registrieren.
- `SseBroadcaster.broadcast(event, JSON.stringify(payload))` für Verteilungen verwenden;
  damit werden disconnectete Clients automatisch entfernt.
- Der Client verwendet `new EventSource('/api/<bereich>/events', { withCredentials: true })`, damit der `httpOnly`-JWT-Cookie mitgesendet wird.
- Befehle/Änderungen vom Client laufen weiterhin über separate `fetch`/`POST`-Aufrufe, nicht über den SSE-Stream.

## Tagebuch- & Welt-Modul

### Tagebuch (`/tagebuch`)

- Benutzer können HTML-basierte Tagebucheinträge erstellen, bearbeiten und löschen.
- KI kann Einträge umschreiben (`rewriteTextWithAi`) und mit einem Befehl nachbearbeiten
  (`improveRewrittenWithCommand`).
- KI generiert eine grobe Zusammenfassung (`summarizeTextWithAi`, max. 500 Zeichen).
- KI extrahiert Personen, Organisationen und Orte (`extractEntitiesFromDiary`).
- Rewrites werden als Dateien unter `rewritten/` gespeichert (`server/diaryFiles.ts`).
- Einträge sind nur für den eigenen Benutzer sichtbar.

### Welt (`/welt`)

- Zeigt alle bekannten Entitäten (Personen, Organisationen, Orte).
- Jede Entität hat:
  - Zusammenfassung (`entitySummaries`)
  - Wissenseinträge (`entityKnowledge`)
  - Verknüpfte Tagebucheinträge
  - Aliase
- Entitäten können bearbeitet, zusammengeführt, reklassifiziert und geblacklistet werden.
- Wissensverteilung nimmt Freitext (z. B. aus dem Tagebuch) und ordnet Fakten Entitäten zu.

### KI-Workflow

1. Prompts in `server/ai/rewrite.ts` / `server/ai/knowledge.ts` instruieren die KI,
   Hintergrundinformationen über MCP-Tools abzufragen, bevor sie Daten speichert.
2. `runOpenCode` in `server/ai/opencode.ts` spawnt `opencode run` und übergibt ein
   kurzlebiges MCP-Session-Token.
3. `server/mcp/index.ts` stellt die Tools bereit (z. B. `get_entity`, `set_diary_summary`,
   `create_knowledge`).
4. Der Scheduler `server/scheduler/entitySummaries.ts` aktualisiert regelmäßig
   Entitäts-Zusammenfassungen.

### MCP Scopes

| Scope | Erlaubte Tools |
|-------|----------------|
| `diary:read` | `get_diary_entry`, `search_diary_entries`, `get_previous_diary_entries` |
| `diary:summarize` | `set_diary_summary` |
| `diary:rewrite` | `set_diary_rewrite` |
| `entity:read` | `list_entities`, `get_entity` |
| `entity:extract` | `link_diary_entity` |
| `entity:summary` | `set_entity_summary` |
| `knowledge:distribute` | `create_knowledge`, `delete_knowledge` |

## Aufnahme-Modul

- Aktivierung: `DISCORD_BOT_TOKEN` und `DISCORD_GUILD_ID` müssen gesetzt sein.
- Der Bot joined einem Voice-Channel und nimmt jeden Sprecher als separate PCM-Datei auf.
- Aufnahmen werden im `recordings/`-Verzeichnis gespeichert.
- Ein Scheduler (`server/discord/scheduler.ts`) transkribiert Fertige mit OpenAI Whisper.
- Transkripte können getrimmt und als Text gespeichert werden.
- Aufnahmen sind nur für Admins sichtbar.

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
- KI-Features sind deaktiviert, wenn `AI_PROVIDER` nicht `opencode` ist oder
  `AI_MODEL` mit `provider/` beginnt.
- Der MCP-Server beendet sich mit Exit-Code 1, wenn kein gültiges `MCP_SESSION_TOKEN` übergeben wurde.

## Dateien, die nicht verändert werden sollten

- `.gitignore` enthält sensible Dateien (`.env`, `*.db`, `dist`, `dist-server`, `rewritten`, `recordings`).
- `server/users.ts` enthält `INITIAL_ADMIN_USERNAME` und liest `ADMIN_PASSWORD` aus `.env`.
- Sicherheitsrelevante Konfigurationen (`rateLimit`, `JWT_SECRET`, `ADMIN_PASSWORD`,
  `trust proxy`, `MCP_TOKEN_SECRET`) sollten nicht gelockert werden.

## Dokumentation

- Diese Datei (`AGENTS.md`) und `README.md` müssen bei größeren Änderungen an Architektur, Features, `.env`-Variablen oder Sicherheitsregeln aktualisiert werden.
- Bei neuen Modulen, Routen, Repositories oder wichtigen Konventionen sollten die entsprechenden Tabellen in `AGENTS.md` erweitert werden.
- Code-Stil, Importkonventionen und Qualitätsrichtlinien sind in [`CodingStandards.md`](./CodingStandards.md) beschrieben.
- Details zur KI, zu MCP-Tools und zu Prompt-Strukturen finden sich in den Dateien unter `server/ai/` und `server/mcp/`.
