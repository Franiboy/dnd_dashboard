# Roadmap D&D Dashboard

> Stand: 2026-08-13
> Zielgruppe: Entwickler und Maintainer des D&D-Dashboards

## 1. Projektziel & Status Quo

Das Dashboard ist eine interne Web-App für eine D&D-Gruppe: Discord-Login, Bingo zur Sessionspause, persönliche Tagebücher, eine gemeinsame Welt-Wissensdatenbank, Discord-Aufnahmen mit Whisper-Transkription und KI-gestützte Zusammenfassungen/Rewrites.

### Was aktuell gut funktioniert

- Solide Basis-Architektur mit **Express 5 + React 19 + Vite + Tailwind 4 + better-sqlite3**.
- Klare Modularisierung in Apps (`src/lib/apps.ts`) und Feature-Flags.
- Sicherheits-Grundausstattung: `httpOnly`-JWT-Cookie, bcrypt, Discord-OAuth-State-Cookie, Rate-Limiting, Account-Lockout, AES-256-GCM für Discord-Tokens.
- KI/MCP-Konzept mit scopeten Tools und `zod`-Validierung ist vorhanden.
- Build, Typecheck und Oxlint laufen fehlerfrei.

### Was die größten Hebel für die nächsten Monate sind

- **Keine automatisierten Tests** – weder Unit- noch Integration- noch E2E-Tests.
- **Keine CI/CD-Pipeline**.
- **KI-Aufgaben laufen als Prozesse im Express-Loop**; bei Neustart sind laufende Jobs verloren.
- **Starke Kopplung an `opencode run` CLI** als einziger KI-Provider.
- **SQLite ist Single-Instance-gebunden**; ein späterer Umzug auf Postgres/Redis sollte vorbereitet werden.
- **Keine zentrale Fehlerbehandlung/Logging-Middleware** im Express-Stack; viel duplizierter `if (!req.user)`-Code.
- **Keine Volltextsuche** für Tagebuch/Welt – wichtig, wenn die Datenmenge wächst.

---

## 2. Strategische Schwerpunkte

1. **Verlässlichkeit zuerst** – Tests, CI, Health-Checks und robuste KI-Job-Verarbeitung.
2. **KI-Layer entkoppeln** – Provider-unabhängige Abstraktion (OpenCode, OpenAI, Anthropic, eigene APIs).
3. **Wissensgraph ausbauen** – bessere Suche, Beziehungen, Visualisierung.
4. **Audio-Modul professionalisieren** – Live-Transkription, Kapitelmarken, Audio-Player.
5. **Produktionsreife** – Backup, Monitoring, Multi-Instance-fähigkeit, Security-Härtung.

---

## 3. Phasen

### Phase 1 – Fundament & Qualität (0–2 Monate)

Fokus: Technische Schulden reduzieren, Vertrauen in Änderungen schaffen.

| #   | Epic                                   | Ziel                                              | Akzeptanzkriterien                                                                                                                                    |
| --- | -------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | **Test-Infrastruktur**                 | Verlässliche Rückmeldung bei Refactorings         | Vitest für Server eingerichtet; Unit-Tests für `repositories/`, `auth.ts`, `ai/actions.ts`; Integrationstests mit `dnd_test.db`; `npm test` lauffähig |
| 1.2 | **CI/CD Pipeline**                     | Keine Regressionen mehr unbemerkt                 | GitHub Actions Workflow für `lint`, `typecheck`, `build`, `test` bei PRs; mind. ein Blocking-Check                                                    |
| 1.3 | **Zentrale Konfigurationsvalidierung** | `.env`-Fehler früh erkennen                       | `zod`-Schema für alle env-vars; klare Fehlermeldung beim Server-Start                                                                                 |
| 1.4 | **Zentrale Express-Fehlerbehandlung**  | Weniger duplizierter Code, bessere HTTP-Responses | `errorHandler`-Middleware; eigene `AppError`-Klasse; 404/500-Responses zentralisiert                                                                  |
| 1.5 | **TypeScript härten**                  | Typ-Sicherheit erhöhen                            | Kein `any` in `auth.ts`/Routes; `cookie-parser`-Typen korrekt integriert                                                                              |
| 1.6 | **Health & Readiness Endpoints**       | Betrieb leichter überwachen                       | `/health`, `/ready`; DB-Check; optional Memory/Version                                                                                                |

**Quick Wins in Phase 1:**

- `npm run test` als Alias für Vitest einrichten (statt nur `test:server`).
- `.env.example` um fehlende Variablen ergänzen und gegen `zod`-Schema prüfen.
- `migrations.ts` aufsplitten in datierte Dateien (z. B. `migrations/001_create_users.ts`) – die Datei ist bereits 570+ Zeilen lang.

---

### Phase 2 – KI, Daten & UX (3–6 Monate)

Fokus: Die KI-Verarbeitung robuster machen und das Wissen besser nutzbar machen.

| #   | Epic                                     | Ziel                                                | Akzeptanzkriterien                                                                                                                                            |
| --- | ---------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | **Persistente KI-Job-Queue**             | Lange KI-Jobs überleben Server-Neustarts            | SQLite- oder Redis-basierte Queue; Jobs für Diary-Rewrite, Summary, Session-Transkript, Bingo-Vorschläge; Fortschritt und Retry-Logik im Admin-Panel sichtbar |
| 2.2 | **KI-Provider-Abstraktion**              | Nicht mehr ausschließlich von `opencode` abhängig   | `AiProvider`-Interface; Implementierungen für `opencode` und mindestens eine direkte API (z. B. OpenAI/Anthropic); `AI_PROVIDER` unterstützt mehrere Werte    |
| 2.3 | **Volltextsuche**                        | Tagebuch und Welt schnell durchsuchbar              | SQLite `FTS5` für Titel/Inhalt/Wissen; API-Endpunkte `GET /api/diary/search`, `GET /api/entities/search`; Frontend-Suchfeld                                   |
| 2.4 | **Entity-Beziehungen & Knowledge-Graph** | Welt wird vernetzt statt nur listenartig            | Beziehungen zwischen Personen/Organisationen/Orten modellieren; einfache Graph-Visualisierung in `/welt`                                                      |
| 2.5 | **Tagebuch-Versionierung**               | KI-Rewrites und manuelle Änderungen nachvollziehbar | Pro Eintrag Historie der letzten N Versionen; Diff-View; Restore                                                                                              |
| 2.6 | **Frontend-State verbessern**            | Weniger manuelles Fetching, bessere UX              | `useApi` durch SWR/React Query ersetzen oder ein React-Query-ähnliches Caching einführen; optimistische Updates                                               |
| 2.7 | **PWA-Grundlagen**                       | Mobile Nutzung ermöglichen                          | Service-Worker via Vite PWA; App-Manifest; Offline-Startseite; Cache-Strategie für statische Assets                                                           |

---

### Phase 3 – Professionalisierung & Skalierung (6–12 Monate)

Fokus: Produktion, Multi-User-Betrieb, erweiterte Features.

| #   | Epic                           | Ziel                                                 | Akzeptanzkriterien                                                                                                                                       |
| --- | ------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | **Multi-Instance-fähigkeit**   | Mehrere Server-Prozesse/Container parallel betreiben | Socket.io Redis-Adapter; Session/JWT weiterhin stateless; optional Postgres-Adapter für SQLite                                                           |
| 3.2 | **Audio-Pipeline 2.0**         | Aufnahmen professioneller nutzbar                    | Live-Transkription (optional); Speaker-Diarization; Kapitelmarken aus Pausen/Topics; integrierter Audio-Player mit Sprung zu Transkript-Zeitstempel      |
| 3.3 | **KI-Verbesserung & Feedback** | Ausgaben werden mit der Zeit besser                  | Prompt-Versionierung; Thumbs-Up/Down pro KI-Ausgabe; Kosten/Nutzungs-Tracking; regelmäßiges Fine-Tuning-Dataset exportieren                              |
| 3.4 | **Sicherheits-Härtung**        | Produktionsbetrieb absichern                         | `helmet`-ähnliche Header (CSP, HSTS, X-Frame-Options); CORS-Origin-Validierung verschärfen; Audit-Log für Admin-Aktionen; Secrets-Rotation dokumentieren |
| 3.5 | **Backup & Wartung**           | Datenverlust ausschließen                            | Nightly SQLite-Backup; `VACUUM`/WAL-Checkpoint-Job; Restore-Dokumentation                                                                                |
| 3.6 | **API-Dokumentation**          | Externe Integrationen ermöglichen                    | OpenAPI/Swagger aus Routes generieren; Endpoints dokumentiert                                                                                            |
| 3.7 | **i18n & Accessibility**       | Nicht-deutschsprachige Nutzer und Screenreader       | i18n-Framework; de/en als Start; Keyboard-Navigation; ARIA-Labels                                                                                        |

---

## 4. Modul-spezifische Ideen (nicht phasengebunden)

### Bingo

- Zufällige Board-Generierung aus dem Task-Pool mit Konfiguration (kein manuelles Ziehen mehr nötig).
- Historie / Hall of Fame der Gewinner pro Spiel.
- Statistik: Welche Tasks am häufigsten vorkamen, durchschnittliche Spieldauer.
- „Spectator“-Modus für nicht spielende Discord-Teilnehmer.
- Export der aktuellen Bingo-Karte als Bild/PNG.

### Diary & World

- Tags/Kategorien für Tagebucheinträge.
- Sitzungs-Tagebuch: Eintrag automatisch mit Discord-Session verknüpfen.
- Orte auf einer Karte markieren (OpenStreetMap / Leaflet).
- Automatische Timeline aus allen Sitzungen und Tagebüchern.
- Verknüpfung von Entitäten mit konkreten Sessions („Erste Erwähnung in Session #12").

### Recordings / Sessions

- Zeitsynchronisiertes Transkript mit Sprecher-Einfärbung.
- „Clip“-Funktion: bestimmten Abschnitt als separates Audio/Video exportieren.
- Automatische Kapitel aus Pausen oder KI-Themen.
- Speicher-Optimierung: Audio nach Transkription optional löschen, nur Transkript behalten.

### Admin

- Audit-Log-Seite mit Filter nach User/Aktion/Zeit.
- Rollenkonzept: neben „Admin" auch „Moderator" (z. B. Bingo verwalten, aber keine User-Administration).
- Nutzungs-Statistiken: Anzahl Einträge, KI-Aufrufe, Aufnahmedauer.
- System-Status: Queue-Länge, laufende KI-Jobs, Discord-Bot-Status.

---

## 5. Nicht-funktionale Ziele

- **Testabdeckung:** Mindestens 60 % im Server-Code nach Phase 1; 75 % für Repository-Layer.
- **Build-Zeit:** Vollständiger Build (`npm run build`) unter 90 Sekunden.
- **Startzeit:** Server-Start inkl. Migrations unter 5 Sekunden (ohne KI-Modell-Download).
- **Verfügbarkeit:** Graceful Shutdown, Health-Checks, keine Datenverluste bei `SIGTERM`.
- **Sicherheit:** Keine Secrets im Log; CSP aktiv; regelmäßiges Dependency-Update.

---

## 6. Risiken & Gegenmaßnahmen

| Risiko                                 | Auswirkung                    | Gegenmaßnahme                                                  |
| -------------------------------------- | ----------------------------- | -------------------------------------------------------------- |
| `opencode` CLI ändert sich             | KI-Features brechen           | Provider-Abstraktion bauen (Phase 2.2)                         |
| SQLite wird zu groß/langsam            | Performance-Probleme          | FTS5, VACUUM, langfristig Postgres-Migration planen            |
| Discord-Bot/API-Änderungen             | Aufnahmen funktionieren nicht | Audio-Modul hinter Interface abstrahieren; Tests mit Mocks     |
| Lange KI-Jobs blockieren Server        | Timeouts, verlorene Jobs      | Job-Queue mit Retry und Persistenz (Phase 2.1)                 |
| Fehlende Tests bremsen Refactoring aus | Technische Schulden wachsen   | Phase 1 komplett abschließen, bevor große Refactorings starten |

---

## 7. Nächste konkrete Schritte (Was als erstes angehen)

1. `ROADMAP.md` mit dem Team abstimmen und priorisieren.
2. Epic 1.1 (Vitest + erste Tests) und 1.2 (GitHub Actions) in einem kleinen Spike umsetzen.
3. `migrations.ts` refactoren, um zukünftige Schema-Änderungen übersichtlicher zu machen.
4. `.env`-Validierung mit `zod` implementieren.
5. Erste Health-Checks ergänzen, damit ein zukünftiges Deployment überwacht werden kann.

---

## 8. Wie diese Roadmap gepflegt wird

- Alle zwei Monate Review: Was wurde erreicht, was hat sich verschoben?
- Bei größeren Architektur- oder Env-Änderungen: `docs/architecture.md`, `docs/environment.md` und diese Datei aktualisieren.
- Neue Features nur mit begleitenden Tests und Docs-Updates.
