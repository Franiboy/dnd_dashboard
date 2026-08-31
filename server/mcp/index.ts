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
  findEntityCanonical,
  getDiaryEntryById,
  getEntryEntities,
  listAllEntityRefs,
  listDiaryEntryContentsByEntity,
  listDiaryEntryHeadlinesByUser,
  listPreviousDiaryEntriesByUser,
  searchDiaryEntries,
  setDiaryEntryLocations,
  setDiaryEntryOrganizations,
  setDiaryEntryPersons,
  updateDiaryEntry,
} from '../repositories/diary.js';
import { entityLabel } from '../repositories/entityRefs.js';
import {
  createEntityKnowledge,
  getEntityKnowledgeEntry,
  listActiveEntityKnowledge,
  markEntityKnowledgeDeleted,
  markEntityKnowledgeTimelineEnd,
} from '../repositories/entityKnowledge.js';
import { getCurrentGameDay } from '../repositories/gameTimeline.js';
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
  getBingoSuggestionBatch,
  submitBingoSuggestionBatch,
} from '../repositories/bingoSuggestions.js';
import { getGame } from '../game.js';
import type { DiaryEntry } from '../../shared/types.js';

const log = createLogger('mcp-server');

runMigrations();

const token = process.env.MCP_SESSION_TOKEN;
const payload = token ? verifyMcpSessionToken(token) : null;
const allowedScopes = new Set<McpScope>(payload?.scopes ?? []);

if (!payload) {
  // No/expired session token: run with empty scopes instead of exiting.
  // All tools are registered behind requireScope(), so a token-less server
  // exposes no functionality. Hard-exiting here made opencode's MCP layer
  // retry/loop and produced "MCP server started without valid session token"
  // errors on every token-less spawn (e.g. by the opencode2 service).
  log.warn('MCP server started without valid session token; running with empty scopes');
}

log.info(`MCP server starting with scopes: ${[...allowedScopes].join(', ')}`);

const server = new McpServer({
  name: 'dnd-dashboard',
  version: '1.0.0',
});

function requireScope(scope: McpScope): boolean {
  return allowedScopes.has(scope);
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
  handler: (
    args: z.infer<z.ZodObject<T>>
  ) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>
): void {
  (server.tool as unknown as (...args: unknown[]) => void)(
    name,
    description,
    argsSchema,
    async (args: unknown) => {
      const summary = formatToolArgs(args as Record<string, unknown>);
      log.info(`MCP tool called: ${name}(${summary})`);
      const start = Date.now();
      try {
        const result = await handler(args as z.infer<z.ZodObject<T>>);
        const outputText = result.content.map((c) => c.text).join('');
        const isError = result.isError ?? false;
        log.info(
          `MCP tool finished: ${name} (duration=${Date.now() - start}ms, isError=${isError}, outputChars=${outputText.length})`
        );
        return result;
      } catch (err) {
        const duration = Date.now() - start;
        log.error(
          `MCP tool failed: ${name} (duration=${duration}ms): ${err instanceof Error ? err.message : String(err)}`
        );
        throw err;
      }
    }
  );
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
    }
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
    }
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
        return error(
          err instanceof Error ? err.message : 'Fehler beim Speichern des Tagebuch-Entwurfs'
        );
      }
    }
  );
}

if (requireScope('entity:extract')) {
  loggedTool(
    'link_diary_entity',
    'Verknüpft eine Entität mit einem Tagebucheintrag. Bei Namensgleichheit muss der Qualifier der gemeinten Entität angegeben werden (siehe list_entities).',
    {
      entryId: z.number().int().positive(),
      type: z.enum(['persons', 'organizations', 'locations']),
      name: z.string().min(1),
      qualifier: z
        .string()
        .optional()
        .describe('Unterscheidungs-Qualifier, falls es mehrere Entitäten mit diesem Namen gibt.'),
    },
    async ({ entryId, type, name, qualifier }) => {
      try {
        const entry = getDiaryEntryWithAccess(entryId);
        if (!entry) return diaryAccessError();
        const ref = ensureEntityExists(type, name, qualifier?.trim() ?? '');
        const current = getEntryEntities(entryId);
        const label = entityLabel(ref);
        const existing = new Set<string>(current[type]);
        existing.add(label);
        if (type === 'persons') setDiaryEntryPersons(entryId, [...existing]);
        else if (type === 'organizations') setDiaryEntryOrganizations(entryId, [...existing]);
        else setDiaryEntryLocations(entryId, [...existing]);
        return success(`Entität ${label} mit Eintrag ${entryId} verknüpft.`);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Verknüpfen der Entität');
      }
    }
  );
}

if (requireScope('entity:summary')) {
  loggedTool(
    'set_entity_summary',
    'Setzt die Zusammenfassung und optionale Mini-Zusammenfassung einer Entität. Bei Namensgleichheit muss der Qualifier der Ziel-Entität angegeben werden.',
    {
      type: z.enum(['persons', 'organizations', 'locations']),
      name: z.string().min(1),
      summary: z.string().min(1),
      miniSummary: z.string().max(200).optional(),
      qualifier: z.string().optional(),
    },
    async ({ type, name, summary, miniSummary, qualifier }) => {
      try {
        const ref = ensureEntityExists(type, name, qualifier?.trim() ?? '');
        setEntitySummary(type, ref.name, summary.trim(), false, miniSummary, ref.qualifier);
        return success(`Zusammenfassung für ${type}/${entityLabel(ref)} gesetzt.`);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Setzen der Zusammenfassung');
      }
    }
  );
}

if (requireScope('knowledge:distribute')) {
  loggedTool(
    'create_knowledge',
    'Erstellt einen Wissenseintrag für eine Entität. Bei Namensgleichheit muss der Qualifier der Ziel-Entität angegeben werden. validFrom/validUntil sind optionale in-game Spieltage (recording_sessions.game_day): damit wird ein zeitgebundener Fakt auf der Chronologie der Entität verankert. Zeitlose Fakten (z. B. "ist eine Elfe") lassen diese Felder weg.',
    {
      type: z.enum(['persons', 'organizations', 'locations']),
      name: z.string().min(1),
      content: z.string().min(1),
      title: z.string().optional(),
      qualifier: z.string().optional(),
      validFrom: z.number().int().optional(),
      validUntil: z.number().int().optional(),
    },
    async ({ type, name, content, title, qualifier, validFrom, validUntil }) => {
      try {
        const ref = ensureEntityExists(type, name, qualifier?.trim() ?? '');
        const entry = createEntityKnowledge(
          type,
          ref.name,
          title?.trim() || null,
          content.trim(),
          'ai_extracted',
          ref.qualifier,
          validFrom ?? null,
          validUntil ?? null
        );
        return success(`Wissenseintrag ${entry.id} für ${type}/${entityLabel(ref)} erstellt.`);
      } catch (err) {
        return error(
          err instanceof Error ? err.message : 'Fehler beim Erstellen des Wissenseintrags'
        );
      }
    }
  );

  loggedTool(
    'delete_knowledge',
    'Markiert einen Wissenseintrag als gelöscht (Widerruf: der Fakt war falsch bzw. trifft nie zu). Für zeitgebundene Änderungen (der Fakt war wahr, gilt aber ab einem Spieltag nicht mehr) end_knowledge verwenden.',
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
        return error(
          err instanceof Error ? err.message : 'Fehler beim Löschen des Wissenseintrags'
        );
      }
    }
  );

  loggedTool(
    'end_knowledge',
    'Beendet einen zeitgebundenen Wissenseintrag: ab dem angegebenen in-game Spieltag gilt der Fakt nicht mehr, bleibt aber als Historie sichtbar. Verwende dies statt delete_knowledge, wenn sich ein Fakt über die Zeit ändert (z. B. "X steht A gut", nach einem Zwischenfall aber nicht mehr).',
    {
      id: z.number().int().positive(),
      until: z.number().int().positive(),
      reason: z.string().optional(),
    },
    async ({ id, until, reason }) => {
      try {
        const existing = getEntityKnowledgeEntry(id);
        if (!existing) return error('Wissenseintrag nicht gefunden');
        if (existing.status !== 'active') return error('Nur aktive Einträge können beendet werden');
        markEntityKnowledgeTimelineEnd(id, until, reason?.trim() || null);
        return success(`Wissenseintrag ${id} bis Spieltag ${until} beendet.`);
      } catch (err) {
        return error(
          err instanceof Error ? err.message : 'Fehler beim Beenden des Wissenseintrags'
        );
      }
    }
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
    }
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
        const entries = searchDiaryEntries(
          query,
          sessionIsAdmin ? undefined : sessionUserId,
          limit ?? 5
        );
        if (entries.length === 0) return success('Keine Tagebucheinträge gefunden.');
        const lines = entries.map((e) => {
          const plain = stripHtml(e.content);
          return `ID ${e.id} | ${e.createdAt} | ${e.title}\n${plain.slice(0, 300)}${plain.length > 300 ? '...' : ''}`;
        });
        return success(lines.join('\n\n'));
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler bei der Suche');
      }
    }
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
        return error(
          err instanceof Error ? err.message : 'Fehler beim Laden der vorherigen Einträge'
        );
      }
    }
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
    }
  );
}

if (requireScope('entity:read')) {
  loggedTool(
    'list_entities',
    'Listet alle bekannten Entitäten (Personen, Organisationen, Orte) mit Qualifier und Mini-Zusammenfassung auf. Optional gefiltert nach Typ.',
    {
      type: z.enum(['persons', 'organizations', 'locations']).optional(),
      limit: z.number().int().positive().max(200).optional(),
    },
    async ({ type, limit }) => {
      try {
        const refs = listAllEntityRefs();
        const all = [
          ...refs.persons.map((ref) => ({ type: 'persons' as const, ref })),
          ...refs.organizations.map((ref) => ({ type: 'organizations' as const, ref })),
          ...refs.locations.map((ref) => ({ type: 'locations' as const, ref })),
        ];
        const filtered = type ? all.filter((e) => e.type === type) : all;
        const limited = filtered.slice(0, limit ?? 100);
        if (limited.length === 0) return success('Keine Entitäten gefunden.');
        const lines = limited.map(({ type: entityType, ref }) => {
          const summary = getEntitySummary(entityType, ref.name, ref.qualifier);
          const mini = summary?.miniSummary ?? summary?.summary ?? null;
          const suffix = mini ? ` – ${truncateText(mini.replace(/\s+/g, ' ').trim(), 120)}` : '';
          return `- ${entityType}: ${entityLabel(ref)}${suffix}`;
        });
        return success(lines.join('\n'));
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Laden der Entitäten');
      }
    }
  );

  loggedTool(
    'get_entity',
    'Liefert Zusammenfassung, aktuell gültiges Wissen und verknüpfte Tagebucheinträge zu einer bestimmten Entität. Bei Namensgleichheit muss der Qualifier angegeben werden.',
    {
      type: z.enum(['persons', 'organizations', 'locations']),
      name: z.string().min(1),
      qualifier: z.string().optional(),
      includeDiaryEntries: z.boolean().optional(),
    },
    async ({ type, name, qualifier, includeDiaryEntries }) => {
      try {
        const canonicalRef = findEntityCanonical(type, name, qualifier?.trim() ?? '');
        if (!canonicalRef) {
          return error(
            `Entität ${type}/${name} nicht gefunden. Verwende list_entities, um passende Namen (und Qualifier) zu finden.`
          );
        }
        const label = entityLabel(canonicalRef);
        const summary = getEntitySummary(type, canonicalRef.name, canonicalRef.qualifier);
        const currentGameDay = getCurrentGameDay();
        const knowledge = listActiveEntityKnowledge(
          type,
          canonicalRef.name,
          canonicalRef.qualifier,
          currentGameDay
        );
        const diaryEntries =
          includeDiaryEntries !== false
            ? listDiaryEntryContentsByEntity(
                type,
                canonicalRef.name,
                sessionIsAdmin ? undefined : (sessionUserId ?? undefined),
                canonicalRef.qualifier
              )
            : [];

        const lines: string[] = [`Entität: ${label} (${type})`];
        lines.push(
          `Aktueller Spieltag der Kampagne: ${currentGameDay ?? 'unbekannt (noch kein Spieltag gesetzt)'}`
        );
        lines.push(`Zusammenfassung: ${summary?.summary ?? '-'}`);
        lines.push(`Mini-Zusammenfassung: ${summary?.miniSummary ?? '-'}`);

        if (knowledge.length > 0) {
          lines.push('');
          lines.push('Wissen (aktuell gültig):');
          for (const entry of knowledge) {
            const title = entry.title ? `${entry.title}: ` : '';
            // valid_until is EXCLUSIVE: the fact holds up to (validUntil - 1).
            const window =
              entry.validFrom !== null || entry.validUntil !== null
                ? entry.validUntil !== null
                  ? ` [ab Spieltag ${entry.validFrom ?? '…'} bis Tag ${entry.validUntil - 1}]`
                  : ` [ab Spieltag ${entry.validFrom ?? '…'}]`
                : '';
            lines.push(`- ${title}${entry.content}${window}`);
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
    }
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

if (requireScope('recording:boundaries')) {
  // The recording contains pre-session team discussion / small talk and
  // post-session chit-chat alongside the actual game play. This tool stores
  // the AI-detected start/end of the game, as seconds from the recording start
  // (the scale used by the transcript timestamps [MM:SS] / [HH:MM:SS]).
  loggedTool(
    'set_session_boundaries',
    'Speichert die ermittelten Start- und Endzeitpunkte der eigentlichen Spiel-Session innerhalb einer Aufnahme. Sekundenangaben sind Offsets vom Beginn der Aufnahme (0 Sekunden = Aufnahmebeginn, [HH:MM:SS] im Transkript).',
    {
      sessionId: z.number().int().positive(),
      startSeconds: z.number().min(0),
      endSeconds: z.number().min(0),
    },
    async ({ sessionId, startSeconds, endSeconds }) => {
      try {
        if (endSeconds <= startSeconds) {
          return error('endSeconds muss größer als startSeconds sein.');
        }
        const session = getSessionById(sessionId);
        if (!session) return error(`Session ${sessionId} nicht gefunden.`);
        updateSession(sessionId, {
          gameStartSeconds: startSeconds,
          gameEndSeconds: endSeconds,
          gameBoundaryDetectedAt: new Date().toISOString(),
        });
        return success(
          `Spielzeitgrenzen für Session ${sessionId} gespeichert: ${startSeconds}s bis ${endSeconds}s.`
        );
      } catch (err) {
        return error(
          err instanceof Error ? err.message : 'Fehler beim Speichern der Spielzeitgrenzen'
        );
      }
    }
  );
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
        return error(
          err instanceof Error ? err.message : 'Fehler beim Laden der Session-Zusammenfassung'
        );
      }
    }
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
        return error(
          err instanceof Error ? err.message : 'Fehler beim Laden der vorherigen Sessions'
        );
      }
    }
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
    }
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
        return error(
          err instanceof Error ? err.message : 'Fehler beim Setzen der langen Zusammenfassung'
        );
      }
    }
  );
}

if (requireScope('bingo:read')) {
  loggedTool(
    'get_bingo_state',
    'Liefert den aktuellen Bingo-Zustand: Spielfeldgröße, Status, Aufgaben getrennt nach Spieler- und DM-Pool, ausstehende Vorschläge und kürzlich abgelehnte Vorschläge.',
    {},
    async () => {
      try {
        const game = getGame();
        const playerTasks = game.tasks.filter((t) => !t.isPrivate && t.audience !== 'dm');
        const dmTasks = game.tasks.filter((t) => t.audience === 'dm');
        const pendingPlayerSuggestions = getAllPendingSuggestionTexts('players');
        const pendingDmSuggestions = getAllPendingSuggestionTexts('dm');
        const rejectedPlayerSuggestions = getRejectedSuggestionTexts('players').slice(-50);
        const rejectedDmSuggestions = getRejectedSuggestionTexts('dm').slice(-50);

        const taskLines = (tasks: typeof game.tasks) =>
          tasks.length > 0 ? tasks.map((t) => `- ${t.text}`) : ['Keine'];

        const lines = [
          `Spielfeldgröße: ${game.gridSize}x${game.gridSize}`,
          `Status: ${game.status}`,
          '',
          'Bereits vorhandene Bingo-Aufgaben im SPIELER-POOL:',
          ...taskLines(playerTasks),
          '',
          'Bereits vorhandene Bingo-Aufgaben im DM-POOL (perspektive Dungeon Master):',
          ...taskLines(dmTasks),
          '',
          'Ausstehende Vorschläge im Spieler-Pool (nicht erneut vorschlagen):',
          ...(pendingPlayerSuggestions.length > 0
            ? pendingPlayerSuggestions.map((t) => `- ${t}`)
            : ['Keine']),
          '',
          'Ausstehende Vorschläge im DM-Pool (nicht erneut vorschlagen):',
          ...(pendingDmSuggestions.length > 0
            ? pendingDmSuggestions.map((t) => `- ${t}`)
            : ['Keine']),
          '',
          'Zuletzt abgelehnte Vorschläge im Spieler-Pool (nicht erneut vorschlagen):',
          ...(rejectedPlayerSuggestions.length > 0
            ? rejectedPlayerSuggestions.map((t) => `- ${t}`)
            : ['Keine']),
          '',
          'Zuletzt abgelehnte Vorschläge im DM-Pool (nicht erneut vorschlagen):',
          ...(rejectedDmSuggestions.length > 0
            ? rejectedDmSuggestions.map((t) => `- ${t}`)
            : ['Keine']),
        ];

        return success(lines.join('\n'));
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Laden des Bingo-Zustands');
      }
    }
  );
}

if (requireScope('bingo:write')) {
  loggedTool(
    'submit_bingo_suggestions',
    'Übergibt generierte Bingo-Vorschläge für einen Batch. Akzeptiert eine batchId und ein Array aus Aufgabentexten.',
    {
      batchId: z.string().describe('Die Batch-ID, die im Prompt übergeben wurde.'),
      suggestions: z.array(z.string()).describe('Array mit Bingo-Aufgabentexten.'),
    },
    async ({ batchId, suggestions }: { batchId: string; suggestions: string[] }) => {
      try {
        const batch = getBingoSuggestionBatch(batchId);
        if (!batch) {
          return error(`Batch ${batchId} nicht gefunden.`);
        }
        if (batch.status !== 'pending') {
          return error(`Batch ${batchId} ist bereits ${batch.status}.`);
        }
        const normalized = suggestions
          .map((text) => text.trim())
          .filter((text) => text.length > 0)
          .map((text) => ({ text, source: 'ai' }));
        submitBingoSuggestionBatch(batchId, normalized);
        return success(`${normalized.length} Bingo-Vorschläge für Batch ${batchId} übergeben.`);
      } catch (err) {
        return error(
          err instanceof Error ? err.message : 'Fehler beim Übergeben der Bingo-Vorschläge'
        );
      }
    }
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
