# D&D Dashboard

Web-basiertes Dashboard für Dungeons & Dragons mit mehreren Modulen:
Bingo, Tagebuch/Welt (KI-gestützt), Discord-Sprachaufzeichnungen und Admin-Verwaltung.

## Features

- Discord OAuth2 Login
- Admin-Freigabe für neue Discord-Benutzer
- JWT-Authentifizierung über Cookie und Auth-Header
- Admin-Panel zur Benutzerverwaltung (Freigabe, Sperren, Admin-Rechte, Löschen, App-Freigaben)
- Admin-Login über Easter Egg (5x auf den Titel klicken)
- Echtzeit-Bingo mit Socket.io (Spielstart, Feldgröße, Reset)
- Gemeinsamer Aufgaben-Pool
- Spieler-Liste
- Brute-Force-Schutz durch Rate-Limiting und Account-Lockout
- Tagebucheinträge mit KI-gestütztem Umschreiben, Zusammenfassen und Entitätsextraktion
- Wissensgraph für Personen, Organisationen und Orte
- Discord-Bot für Sprachaufzeichnungen mit Whisper-Transkription

## Tech Stack

- **Backend:** Node.js 22+, Express 5, SQLite (better-sqlite3), Socket.io
- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS 4
- **Echtzeit:** Socket.io, Server-Sent Events (SSE)
- **Auth:** JWT, bcrypt, Discord OAuth2
- **KI/MCP:** OpenCode-CLI, `@modelcontextprotocol/sdk`, eigener MCP-Server
- **Discord:** discord.js, @discordjs/voice

## Voraussetzungen

- Node.js >= 22
- npm
- Für KI: [OpenCode](https://github.com/opencode-ai/opencode) CLI installiert und im PATH
- Für Aufnahmen: Discord-Bot-Token, Python + ffmpeg + OpenAI Whisper

## Installation

```bash
npm install
```

Kopiere die Beispiel-Umgebungsvariablen:

```bash
cp .env.example .env
```

Passe `.env` an:

```bash
PORT=3001
JWT_SECRET=änder-dich-in-produktion
ADMIN_PASSWORD=dein-sehr-sicheres-passwort
DISCORD_CLIENT_ID=deine-client-id
DISCORD_CLIENT_SECRET=dein-client-secret
DISCORD_REDIRECT_URI=http://localhost:5173/auth/discord
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

Beim ersten Start wird ein Admin-Account erstellt. Das Passwort wird aus der Umgebungsvariablen `ADMIN_PASSWORD` gelesen.

- Username: `admin`
- Passwort: Wert aus `ADMIN_PASSWORD` in `.env`

Der Default Admin kann über ein Easter Egg erreicht werden: Auf der Login-Seite 5 Mal auf den Titel klicken, dann erscheint der Admin Login Link. Der Admin kann im Admin-Panel Benutzer freigeben, löschen, Admin-Rechte vergeben und einzelne Apps pro Benutzer deaktivieren.

## Datenbank

Die SQLite-Datenbank wird als `dnd.db` im Projektroot angelegt. Sie enthält Benutzer-, Spiel-, Tagebuch-, Entitäts- und Aufnahmedaten und ist in `.gitignore` eingetragen.

Für Tests kann eine separate Datenbank verwendet werden:

```bash
DB_PATH=dnd_test.db npm run server
```

Oder über das Script:

```bash
npm run test:server
```

## KI / Tagebuch & Welt

Die KI-Funktionen benötigen `AI_PROVIDER=opencode` und ein gültiges `AI_MODEL`, z. B.:

```bash
AI_PROVIDER=opencode
AI_MODEL=anthropic/claude-sonnet-4-20250514
# Optional für günstigere Aufgaben:
AI_CHEAP_MODEL=openai/gpt-4.1-mini
```

Optional kann `AI_OPENCODE_BIN` den Pfad zur OpenCode-CLI setzen.

Die KI nutzt einen eigenen MCP-Server, um Tools wie `get_entity`, `set_diary_summary` und `create_knowledge` aufzurufen. Das Token dafür wird automatisch aus `JWT_SECRET` (oder `MCP_TOKEN_SECRET`) generiert.

## Aufnahmen

Für den Discord-Sprachaufzeichnungs-Bot:

```bash
DISCORD_BOT_TOKEN=dein-bot-token
DISCORD_GUILD_ID=deine-guild-id
WHISPER_LANGUAGE=de
WHISPER_MODEL=base
```

Der Bot joint Voice-Channels und speichert Aufnahmen unter `recordings/`.
Der Scheduler transkribiert abgeschlossene Aufnahmen automatisch mit OpenAI Whisper.

## Test

Derzeit ist kein Test-Runner konfiguriert. Der Server kann mit einer separaten Test-Datenbank gestartet werden:

```bash
npm run test:server
```

## Wichtige Dateien

- `server/index.ts` – Express- und Socket.io-Setup, API-Routen
- `server/auth.ts` – JWT-Handling und Middleware
- `server/users.ts` – Benutzerdatenbank und Authentifizierung
- `server/database.ts` – SQLite-Verbindung
- `server/game.ts` – Bingo-Spiel-Logik
- `server/socket.ts` – Socket.io-Handler
- `server/routes/` – API-Routen (auth, admin, diary, entities, recordings, ai)
- `server/ai/` – KI-Prompts und OpenCode-Integration
- `server/mcp/` – MCP-Server für KI-Tools
- `server/discord/` – Discord-Bot und Aufnahmeverarbeitung
- `shared/types.ts` – Gemeinsame TypeScript-Typen
- `src/App.tsx` – React-App-Einstieg
- `src/lib/apps.ts` – App-Definitionen
- `AGENTS.md` – Ausführliche Entwicklerdokumentation
