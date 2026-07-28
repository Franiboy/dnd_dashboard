# Coding Standards – D&D Dashboard

Diese Datei fasst die wichtigsten Code-Konventionen und Qualitätsrichtlinien für das Projekt zusammen.
Sie ergänzt `AGENTS.md` und gilt für Client- und Server-Code.

## Allgemein

- **Sprache:** TypeScript mit `strict: true` in allen `tsconfig.*.json`.
- **Module:** ESM (`"type": "module"` in `package.json`).
- **Formatierung:** Konsistente Einrückung (2 Leerzeichen) und semantische Leerzeilen. Keine expliziten Linter-Regeln außer `oxlint`.
- **Kommentare:** Keine überflüssigen Kommentare. Code sollte selbsterklärend sein. Nur komplexe Business-Regeln oder Workarounds kurz erklären.

## Server (`server/`)

### Imports

- Server-Imports verwenden **immer `.js`-Suffixe** (ESM / NodeNext), auch bei `.ts`-Quelldateien:

  ```ts
  import { db } from './database.js';
  import type { User } from '../shared/types.js';
  ```

- `import type` für reine Typ-Imports verwenden.

### Architektur

- **Repository-Pattern** für Datenbankzugriff bevorzugen (siehe `server/repositories/`).
- Geschäftslogik nicht direkt in Routes ablegen, sondern in Repositories oder dedizierte Service-Dateien auslagern.
- Express-Routes exportieren ein `Router` als Default-Export.

### Fehlerbehandlung

- Explizite Fehlerantworten mit aussagekräftigen, aber nicht zu detaillierten Meldungen.
- `try/catch` nur dort, wo tatsächlich etwas schiefgehen kann (Datenbank, Dateisystem, externe Prozesse).
- Keine Stack-Traces oder interne Fehlerdetails an den Client senden.

### Logging

- Immer `createLogger('category')` aus `server/logger.ts` verwenden.
- Keine `console.log`/`console.error` im Produktivcode (Ausnahmen: Startup- und Shutdown-Meldungen in `index.ts`).
- Log-Kategorien kurz und prägnant wählen, z. B. `diaryRoutes`, `opencode`, `mcp-server`.

### Datenbank

- `db.prepare(...)` mit parametrisierten Queries verwenden; keine String-Concatenation bei Bedingungen, außer bei dynamisch zusammengesetzten `IN`-Listen.
- Migrationen in `server/migrations.ts` ablegen, nie manuell Schema-Änderungen außerhalb von Migrationen.

### KI / MCP

- KI-Prompts zentral in `server/ai/rewrite.ts` oder `server/ai/knowledge.ts` pflegen.
- Prompts müssen klar trennen: Rolle → Aufgabe → Tools → Regeln → Input.
- Neue MCP-Tools in `server/mcp/index.ts` registrieren und der passenden Scope-Gruppe zuordnen (`server/mcp/tokens.ts`).
- `zod` für Parameter-Validierung in MCP-Tools verwenden.

### Sicherheit

- Secrets niemals loggen oder an den Client senden.
- Auth-Middleware (`authMiddleware`, `requireAdmin`, `requireApproved`) konsistent verwenden.
- Rate-Limiting nicht abschalten oder lockern.

## Client (`src/`)

### Imports

- Client-Imports verwenden **kein `.js`-Suffix**:

  ```ts
  import { useAuth } from './hooks/useAuth';
  ```

- Absolute Imports über `@/` sind nicht konfiguriert; relative Pfade verwenden.

### Komponenten

- Komponenten als Funktionskomponenten mit TypeScript-Typen schreiben.
- Gemeinsam genutzte Komponenten in `src/components/`, Seiten in `src/pages/`.
- Custom Hooks in `src/hooks/`.
- Globale Zustände in `src/contexts/`.

### Tailwind CSS

- Utility-Klassen bevorzugen; eigene CSS-Dateien nur wenn nötig.
- Konsistente Abstände und Farben über Tailwind-Standardwerte verwenden.

### API-Aufrufe

- `useApi` für HTTP-Requests verwenden, damit Fehler automatisch als Toast angezeigt werden.
- SSE-Endpunkte mit `withCredentials: true` abonnieren.

## Shared (`shared/`)

- Hier leben alle TypeScript-Typen und Interfaces, die Frontend und Backend gemeinsam nutzen.
- Keine Runtime-Logik in `shared/` ablegen.
- Server-Imports aus `shared/` verwenden `.js`-Suffixe.

## Scripts (`scripts/`)

- Build- und Hilfsscripts mit `tsx` ausführbar.
- Keine sensiblen Daten in Scripts schreiben.

## Git

- Keine Secrets, Datenbanken, Build-Artefakte oder Logs committen.
- Commit-Messages kurz und auf Deutsch oder Englisch; im Projekt wird Deutsch bevorzugt.
- Vor jedem Commit `git diff` prüfen.
