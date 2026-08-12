import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import { runMigrations } from '../migrations.js';
import '../database.js';
import { stripHtml } from '../ai/rewrite.js';
import {
  applySessionDiaryDraftToEntry,
  createSessionDiaryDraft,
  ensureEntityExists,
  findEntityCanonicalName,
  getDiaryEntryById,
  getEntryEntities,
  listAllEntityNames,
  listDiaryEntryContentsByEntity,
  listDiaryEntryHeadlinesByUser,
  listPreviousDiaryEntriesByUser,
  searchDiaryEntries,
  setDiaryEntryLocations,
  setDiaryEntryOrganizations,
  setDiaryEntryPersons,
  updateDiaryEntry,
} from '../repositories/diary.js';
import {
  createEntityKnowledge,
  getEntityKnowledgeEntry,
  listActiveEntityKnowledge,
  markEntityKnowledgeDeleted,
} from '../repositories/entityKnowledge.js';
import { getEntitySummary, setEntitySummary } from '../repositories/entitySummaries.js';
import { writeRewrittenFile } from '../diaryFiles.js';
import { normalizeToHtml } from '../ai/rewrite.js';
import { sanitizeHtml } from '../utils/sanitizeHtml.js';
import { verifyMcpSessionToken, type McpScope } from './tokens.js';
import {
  getSessionById,
  updateSession,
  getSessionSummaryById,
  listPreviousSessionSummaries,
} from '../repositories/recordings.js';
import {
  getAllPendingSuggestionTexts,
  getRejectedSuggestionTexts,
} from '../repositories/bingoSuggestions.js';
import { getGame } from '../game.js';
import type { DiaryEntry } from '../../shared/types.js';

const log = createLogger('mcp-server');

runMigrations();

const token = process.env.MCP_SESSION_TOKEN;
const payload = token ? verifyMcpSessionToken(token) : null;
const allowedScopes = new Set<McpScope>(payload?.scopes ?? []);

if (!payload) {
  log.error('MCP server started without valid session token');
  process.exit(1);
}

log.info(`MCP server starting with scopes: ${[...allowedScopes].join(', ')}`);

const server = new McpServer({
  name: 'dnd-dashboard',
  version: '1.0.0',
});

function requireScope(scope: McpScope): boolean {
  if (!allowedScopes.has(scope)) {
    log.warn(`Scope ${scope} not allowed for this MCP session`);
    return false;
  }
  return true;
}

function success(message: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: message }] };
}

function error(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

const sessionUserId = payload?.userId ?? null;
const sessionIsAdmin = payload?.isAdmin ?? false;

function canAccessDiaryEntry(entry: DiaryEntry | null): boolean {
  if (!entry) return false;
  if (!sessionUserId) return false;
  if (sessionIsAdmin) return true;
  return entry.userId === sessionUserId;
}

function getDiaryEntryWithAccess(entryId: number): DiaryEntry | null {
  const entry = getDiaryEntryById(entryId);
  return canAccessDiaryEntry(entry) ? entry : null;
}

function diaryAccessError(): ReturnType<typeof error> {
  return error('Zugriff auf den Tagebucheintrag verweigert');
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function formatToolArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
    .map(([key, value]) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      return `${key}=${truncateText(text, 100)}`;
    })
    .join(', ');
  return entries || 'no args';
}

function loggedTool<T extends z.ZodRawShape>(
  name: string,
  description: string,
  argsSchema: T,
  handler: (args: z.infer<z.ZodObject<T>>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>,
): void {
  (server.tool as unknown as (...args: unknown[]) => void)(name, description, argsSchema, async (args: unknown) => {
    const summary = formatToolArgs(args as Record<string, unknown>);
    log.info(`MCP tool called: ${name}(${summary})`);
    const start = Date.now();
    try {
      const result = await handler(args as z.infer<z.ZodObject<T>>);
      const outputText = result.content.map((c) => c.text).join('');
      const isError = result.isError ?? false;
      log.info(
        `MCP tool finished: ${name} (duration=${Date.now() - start}ms, isError=${isError}, outputChars=${outputText.length})`,
      );
      return result;
    } catch (err) {
      const duration = Date.now() - start;
      log.error(`MCP tool failed: ${name} (duration=${duration}ms): ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  });
}

if (requireScope('diary:summarize')) {
  loggedTool(
    'set_diary_summary',
    'Setzt die Zusammenfassung eines Tagebucheintrags.',
    {
      entryId: z.number().int().positive(),
      summary: z.string().min(1).max(500),
    },
    async ({ entryId, summary }) => {
      try {
        const entry = getDiaryEntryWithAccess(entryId);
        if (!entry) return diaryAccessError();
        updateDiaryEntry(entryId, { summary: summary.trim() });
        return success(`Zusammenfassung für Eintrag ${entryId} gesetzt.`);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Setzen der Zusammenfassung');
      }
    },
  );
}

if (requireScope('diary:rewrite')) {
  loggedTool(
    'set_diary_rewrite',
    'Speichert den umgeschriebenen HTML-Inhalt eines Tagebucheintrags.',
    {
      entryId: z.number().int().positive(),
      html: z.string().min(1),
    },
    async ({ entryId, html }) => {
      try {
        const entry = getDiaryEntryWithAccess(entryId);
        if (!entry) return diaryAccessError();
        writeRewrittenFile(entryId, normalizeToHtml(sanitizeHtml(html)));
        return success(`Rewrite für Eintrag ${entryId} gespeichert.`);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Speichern des Rewrites');
      }
    },
  );
}

if (requireScope('diary:draft')) {
  loggedTool(
    'set_session_diary_draft',
    'Erstellt oder aktualisiert einen KI-Tagebuch-Entwurf aus einer Session. Wenn targetEntryId angegeben ist, wird der Entwurf an einen bestehenden Eintrag angehängt (als KI-Version), sonst wird ein neuer Eintrag angelegt.',
    {
      sessionId: z.number().int().positive(),
      title: z.string().min(1).max(200),
      html: z.string().min(1),
      targetEntryId: z.number().int().positive().optional(),
    },
    async ({ sessionId, title, html, targetEntryId }) => {
      try {
        if (!sessionUserId) return error('Kein Benutzerkontext vorhanden');
        const session = getSessionById(sessionId);
        if (!session) return error(`Session ${sessionId} nicht gefunden.`);
        if (targetEntryId) {
          const entry = getDiaryEntryById(targetEntryId);
          if (!entry || entry.userId !== sessionUserId) return diaryAccessError();
          const updated = applySessionDiaryDraftToEntry(targetEntryId, sessionId, html);
          if (!updated) return error('Fehler beim Speichern des Entwurfs');
          return success(`Entwurf für Eintrag ${updated.id} gespeichert.`);
        }
        const created = createSessionDiaryDraft(sessionUserId, title, sessionId, html);
        return success(`Neuer Entwurf als Eintrag ${created.id} erstellt.`);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Speichern des Tagebuch-Entwurfs');
      }
    },
  );
}

if (requireScope('entity:extract')) {
  loggedTool(
    'link_diary_entity',
    'Verknüpft eine Entität mit einem Tagebucheintrag.',
    {
      entryId: z.number().int().positive(),
      type: z.enum(['persons', 'organizations', 'locations']),
      name: z.string().min(1),
    },
    async ({ entryId, type, name }) => {
      try {
        const entry = getDiaryEntryWithAccess(entryId);
        if (!entry) return diaryAccessError();
        const canonical = ensureEntityExists(type, name);
        const current = getEntryEntities(entryId);
        const existing = new Set<string>(current[type]);
        existing.add(canonical);
        if (type === 'persons') setDiaryEntryPersons(entryId, [...existing]);
        else if (type === 'organizations') setDiaryEntryOrganizations(entryId, [...existing]);
        else setDiaryEntryLocations(entryId, [...existing]);
        return success(`Entität ${canonical} mit Eintrag ${entryId} verknüpft.`);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Verknüpfen der Entität');
      }
    },
  );
}

if (requireScope('entity:summary')) {
  loggedTool(
    'set_entity_summary',
    'Setzt die Zusammenfassung und optionale Mini-Zusammenfassung einer Entität.',
    {
      type: z.enum(['persons', 'organizations', 'locations']),
      name: z.string().min(1),
      summary: z.string().min(1),
      miniSummary: z.string().max(200).optional(),
    },
    async ({ type, name, summary, miniSummary }) => {
      try {
        const canonical = ensureEntityExists(type, name);
        setEntitySummary(type, canonical, summary.trim(), false, miniSummary);
        return success(`Zusammenfassung für ${type}/${canonical} gesetzt.`);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Setzen der Zusammenfassung');
      }
    },
  );
}

if (requireScope('knowledge:distribute')) {
  loggedTool(
    'create_knowledge',
    'Erstellt einen Wissenseintrag für eine Entität.',
    {
      type: z.enum(['persons', 'organizations', 'locations']),
      name: z.string().min(1),
      content: z.string().min(1),
      title: z.string().optional(),
    },
    async ({ type, name, content, title }) => {
      try {
        const canonical = ensureEntityExists(type, name);
        const entry = createEntityKnowledge(type, canonical, title?.trim() || null, content.trim(), 'ai_extracted');
        return success(`Wissenseintrag ${entry.id} für ${type}/${canonical} erstellt.`);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Erstellen des Wissenseintrags');
      }
    },
  );

  loggedTool(
    'delete_knowledge',
    'Markiert einen Wissenseintrag als gelöscht.',
    {
      id: z.number().int().positive(),
      reason: z.string().optional(),
    },
    async ({ id, reason }) => {
      try {
        const existing = getEntityKnowledgeEntry(id);
        if (!existing) return error('Wissenseintrag nicht gefunden');
        markEntityKnowledgeDeleted(id, reason?.trim() || null);
        return success(`Wissenseintrag ${id} als gelöscht markiert.`);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Löschen des Wissenseintrags');
      }
    },
  );
}

if (requireScope('diary:read')) {
  loggedTool(
    'get_diary_entry',
    'Liefert einen bestimmten Tagebucheintrag inklusive Titel, Inhalt, Zusammenfassung und verknüpfter Entitäten.',
    {
      entryId: z.number().int().positive(),
    },
    async ({ entryId }) => {
      try {
        const entry = getDiaryEntryWithAccess(entryId);
        if (!entry) return diaryAccessError();
        const lines = [
          `ID: ${entry.id}`,
          `Titel: ${entry.title}`,
          `Datum: ${entry.createdAt}`,
          `Zusammenfassung: ${entry.summary ?? '-'}`,
          `Personen: ${entry.persons.join(', ') || '-'}`,
          `Organisationen: ${entry.organizations.join(', ') || '-'}`,
          `Orte: ${entry.locations.join(', ') || '-'}`,
          '',
          'Inhalt (Plain Text):',
          stripHtml(entry.content),
        ];
        return success(lines.join('\n'));
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Laden des Tagebucheintrags');
      }
    },
  );

  loggedTool(
    'search_diary_entries',
    'Sucht nach Tagebucheinträgen, die einen Suchbegriff im Titel oder Inhalt enthalten.',
    {
      query: z.string().min(1),
      limit: z.number().int().positive().max(20).optional(),
    },
    async ({ query, limit }) => {
      try {
        if (!sessionUserId) return error('Kein Benutzerkontext vorhanden');
        const entries = searchDiaryEntries(query, sessionIsAdmin ? undefined : sessionUserId, limit ?? 5);
        if (entries.length === 0) return success('Keine Tagebucheinträge gefunden.');
        const lines = entries.map((e) => {
          const plain = stripHtml(e.content);
          return `ID ${e.id} | ${e.createdAt} | ${e.title}\n${plain.slice(0, 300)}${plain.length > 300 ? '...' : ''}`;
        });
        return success(lines.join('\n\n'));
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler bei der Suche');
      }
    },
  );

  loggedTool(
    'get_previous_diary_entries',
    'Liefert die vorherigen Tagebucheinträge desselben Autors vor einem bestimmten Eintrag.',
    {
      entryId: z.number().int().positive(),
      limit: z.number().int().positive().max(10).optional(),
    },
    async ({ entryId, limit }) => {
      try {
        const entry = getDiaryEntryWithAccess(entryId);
        if (!entry) return diaryAccessError();
        const entries = listPreviousDiaryEntriesByUser(entry.userId, entry.createdAt, limit ?? 3);
        if (entries.length === 0) return success('Keine vorherigen Tagebucheinträge gefunden.');
        const lines = entries.map((e) => {
          const plain = stripHtml(e.content);
          return `ID ${e.id} | ${e.createdAt} | ${e.title}\n${plain.slice(0, 300)}${plain.length > 300 ? '...' : ''}`;
        });
        return success(lines.join('\n\n'));
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Laden der vorherigen Einträge');
      }
    },
  );

  loggedTool(
    'list_user_diary_entries',
    'Listet die Tagebucheinträge des aktuellen Benutzers mit Titel, Datum und Inhaltsvorschau auf.',
    {
      limit: z.number().int().positive().max(50).optional(),
    },
    async ({ limit }) => {
      try {
        if (!sessionUserId) return error('Kein Benutzerkontext vorhanden');
        const entries = listDiaryEntryHeadlinesByUser(sessionUserId, limit ?? 20);
        if (entries.length === 0) return success('Keine Tagebucheinträge gefunden.');
        const lines = entries.map((e) => {
          const preview = e.content.length > 0 ? e.content : '(leerer Eintrag)';
          return `ID ${e.id} | ${e.createdAt} | ${e.title}\n${preview}`;
        });
        return success(lines.join('\n\n'));
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Laden der Tagebucheinträge');
      }
    },
  );
}

if (requireScope('entity:read')) {
  loggedTool(
    'list_entities',
    'Listet alle bekannten Entitäten (Personen, Organisationen, Orte) auf. Optional gefiltert nach Typ.',
    {
      type: z.enum(['persons', 'organizations', 'locations']).optional(),
      limit: z.number().int().positive().max(200).optional(),
    },
    async ({ type, limit }) => {
      try {
        const names = listAllEntityNames();
        const all = [
          ...names.persons.map((name) => ({ type: 'persons', name })),
          ...names.organizations.map((name) => ({ type: 'organizations', name })),
          ...names.locations.map((name) => ({ type: 'locations', name })),
        ];
        const filtered = type ? all.filter((e) => e.type === type) : all;
        const limited = filtered.slice(0, limit ?? 100);
        if (limited.length === 0) return success('Keine Entitäten gefunden.');
        return success(limited.map((e) => `- ${e.type}: ${e.name}`).join('\n'));
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Laden der Entitäten');
      }
    },
  );

  loggedTool(
    'get_entity',
    'Liefert Zusammenfassung, aktives Wissen und verknüpfte Tagebucheinträge zu einer bestimmten Entität.',
    {
      type: z.enum(['persons', 'organizations', 'locations']),
      name: z.string().min(1),
      includeDiaryEntries: z.boolean().optional(),
    },
    async ({ type, name, includeDiaryEntries }) => {
      try {
        const canonical = findEntityCanonicalName(type, name);
        if (!canonical) {
          return error(`Entität ${type}/${name} nicht gefunden. Verwende list_entities, um passende Namen zu finden.`);
        }
        const summary = getEntitySummary(type, canonical);
        const knowledge = listActiveEntityKnowledge(type, canonical);
        const diaryEntries =
          includeDiaryEntries !== false
            ? listDiaryEntryContentsByEntity(type, canonical, sessionIsAdmin ? undefined : sessionUserId ?? undefined)
            : [];

        const lines: string[] = [`Entität: ${canonical} (${type})`];
        lines.push(`Zusammenfassung: ${summary?.summary ?? '-'}`);
        lines.push(`Mini-Zusammenfassung: ${summary?.miniSummary ?? '-'}`);

        if (knowledge.length > 0) {
          lines.push('');
          lines.push('Wissen:');
          for (const entry of knowledge) {
            const title = entry.title ? `${entry.title}: ` : '';
            lines.push(`- ${title}${entry.content}`);
          }
        }

        if (diaryEntries.length > 0) {
          lines.push('');
          lines.push('Verknüpfte Tagebucheinträge:');
          for (const entry of diaryEntries.slice(0, 5)) {
            const plain = stripHtml(entry.content);
            lines.push(`ID ${entry.id} | ${entry.createdAt} | ${entry.title}`);
            lines.push(`${plain.slice(0, 200)}${plain.length > 200 ? '...' : ''}`);
          }
        }

        return success(lines.join('\n'));
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Laden der Entität');
      }
    },
  );
}

function formatSessionSummary(session: {
  id: number;
  name: string;
  startedAt: string;
  summary: string | null;
  summaryGeneratedAt: string | null;
  longSummary: string | null;
  longSummaryGeneratedAt: string | null;
}): string {
  const lines = [
    `Session ID: ${session.id}`,
    `Name: ${session.name}`,
    `Datum: ${session.startedAt}`,
    '',
    'Kurze Zusammenfassung:',
    session.summary ?? '(noch nicht erstellt)',
    '',
    'Lange Zusammenfassung:',
    session.longSummary ?? '(noch nicht erstellt)',
  ];
  return lines.join('\n');
}

if (requireScope('recording:read')) {
  loggedTool(
    'get_session_summary',
    'Liefert die kurze und lange Zusammenfassung einer bestimmten Aufnahme-Session.',
    {
      sessionId: z.number().int().positive(),
    },
    async ({ sessionId }) => {
      try {
        const session = getSessionSummaryById(sessionId);
        if (!session) return error(`Session ${sessionId} nicht gefunden.`);
        return success(formatSessionSummary(session));
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Laden der Session-Zusammenfassung');
      }
    },
  );

  loggedTool(
    'get_previous_session_summaries',
    'Liefert die Zusammenfassungen der vorherigen Aufnahme-Sessions (absteigend nach Datum).',
    {
      sessionId: z.number().int().positive(),
      limit: z.number().int().positive().max(10).optional(),
    },
    async ({ sessionId, limit }) => {
      try {
        const sessions = listPreviousSessionSummaries(sessionId, limit ?? 5);
        if (sessions.length === 0) return success('Keine vorherigen Sessions gefunden.');
        return success(sessions.map(formatSessionSummary).join('\n\n---\n\n'));
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Laden der vorherigen Sessions');
      }
    },
  );
}

if (requireScope('recording:summarize')) {
  loggedTool(
    'set_session_summary',
    'Setzt die kurze Zusammenfassung (Stichpunkte, max. 500 Zeichen) einer Aufnahme-Session.',
    {
      sessionId: z.number().int().positive(),
      summary: z.string().min(1).max(500),
    },
    async ({ sessionId, summary }) => {
      try {
        const session = getSessionById(sessionId);
        if (!session) return error(`Session ${sessionId} nicht gefunden.`);
        updateSession(sessionId, {
          summary: summary.trim(),
          summaryGeneratedAt: new Date().toISOString(),
        });
        return success(`Kurze Zusammenfassung für Session ${sessionId} gesetzt.`);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Setzen der Zusammenfassung');
      }
    },
  );

  loggedTool(
    'set_session_long_summary',
    'Setzt die ausführliche HTML-Zusammenfassung einer Aufnahme-Session.',
    {
      sessionId: z.number().int().positive(),
      longSummary: z.string().min(1),
    },
    async ({ sessionId, longSummary }) => {
      try {
        const session = getSessionById(sessionId);
        if (!session) return error(`Session ${sessionId} nicht gefunden.`);
        updateSession(sessionId, {
          longSummary: sanitizeHtml(longSummary).trim(),
          longSummaryGeneratedAt: new Date().toISOString(),
        });
        return success(`Lange Zusammenfassung für Session ${sessionId} gesetzt.`);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Setzen der langen Zusammenfassung');
      }
    },
  );
}

if (requireScope('bingo:read')) {
  loggedTool(
    'get_bingo_state',
    'Liefert den aktuellen Bingo-Zustand: Spielfeldgröße, Status, öffentliche Aufgaben, ausstehende Vorschläge und kürzlich abgelehnte Vorschläge.',
    {},
    async () => {
      try {
        const game = getGame();
        const pendingSuggestions = getAllPendingSuggestionTexts();
        const rejectedSuggestions = getRejectedSuggestionTexts().slice(-50);

        const lines = [
          `Spielfeldgröße: ${game.gridSize}x${game.gridSize}`,
          `Status: ${game.status}`,
          '',
          'Bereits vorhandene öffentliche Bingo-Aufgaben:',
          ...(game.tasks.some((t) => !t.isPrivate)
            ? game.tasks.filter((t) => !t.isPrivate).map((t) => `- ${t.text}`)
            : ['Keine']),
          '',
          'Ausstehende Vorschläge im Pool (nicht erneut vorschlagen):',
          ...(pendingSuggestions.length > 0 ? pendingSuggestions.map((t) => `- ${t}`) : ['Keine']),
          '',
          'Zuletzt abgelehnte Vorschläge (nicht erneut vorschlagen):',
          ...(rejectedSuggestions.length > 0 ? rejectedSuggestions.map((t) => `- ${t}`) : ['Keine']),
        ];

        return success(lines.join('\n'));
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Laden des Bingo-Zustands');
      }
    },
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('MCP server connected on stdio');
}

main().catch((err) => {
  log.error('Fatal error in MCP server:', err);
  process.exit(1);
});
