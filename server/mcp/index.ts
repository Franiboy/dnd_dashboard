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
  setDiaryEntryItems,
  setDiaryEntryOrganizations,
  setDiaryEntryPersons,
  updateDiaryEntry,
} from '../repositories/diary.js';
import { entityLabel } from '../repositories/entityRefs.js';
import {
  createEntityKnowledge,
  getEntityKnowledgeEntry,
  listActiveEntityKnowledge,
  listEntityKnowledge,
  markEntityKnowledgeDeleted,
  markEntityKnowledgeTimelineEnd,
} from '../repositories/entityKnowledge.js';
import { getCurrentGameDay, setSessionGameDayRange } from '../repositories/gameTimeline.js';
import { getEntitySummary, setEntitySummary } from '../repositories/entitySummaries.js';
import { getStoryArcDayRange, knowledgeOverlapsArcRange } from '../repositories/storyArcs.js';
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
import { replaceSessionEvents } from '../repositories/timeline.js';
import type { DiaryEntry, TimelineEventInput } from '../../shared/types.js';
import type { Language } from '../../shared/types.js';
import { getAiOutputLanguage, localize } from '../ai/promptLanguage.js';

const log = createLogger('mcp-server');
const outputLanguage: Language = getAiOutputLanguage();
const t = (german: string, english: string): string => localize(outputLanguage, german, english);

runMigrations();

const token = process.env.MCP_SESSION_TOKEN;
const payload = token ? verifyMcpSessionToken(token) : null;
const allowedScopes = new Set<McpScope>(payload?.scopes ?? []);

if (!payload) {
  // No/expired session token: run with empty scopes instead of exiting.
  // All tools are registered behind requireScope(), so a token-less server
  // exposes no functionality. Hard-exiting here made opencode's MCP layer
  // retry/loop and produced "MCP server started without valid session token"
  // errors on every token-less spawn (e.g. by the opencode background server).
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
// Story arc of the processed object (resolved server-side before the run).
// When set, context tools scope their queries to this arc so AI runs never
// scan the whole campaign history.
const sessionArcId = payload?.arcId ?? null;
// Grants full read access to all players' diary entries for shared-world
// flows (knowledge verify/correct/summary) even when the acting user is not
// an admin - entities, knowledge and the world belong to everyone.
const canReadAllDiaries = allowedScopes.has('diary:read-all') || sessionIsAdmin;

function canAccessDiaryEntry(entry: DiaryEntry | null): boolean {
  if (!entry) return false;
  if (canReadAllDiaries) return true;
  if (!sessionUserId) return false;
  return entry.userId === sessionUserId;
}

function getDiaryEntryWithAccess(entryId: number): DiaryEntry | null {
  const entry = getDiaryEntryById(entryId);
  return canAccessDiaryEntry(entry) ? entry : null;
}

function diaryAccessError(): ReturnType<typeof error> {
  return error(
    t('Zugriff auf den Tagebucheintrag verweigert', 'Access to the diary entry was denied')
  );
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

/**
 * Server-side guard for knowledge mutations: when the session token carries a
 * knowledgeTarget (single-entity tasks like "review entity"), any create/end/
 * delete that does not belong to that entity is rejected. Without a target the
 * handlers keep their previous unrestricted behaviour.
 */
function assertKnowledgeTargetAllowed(
  entityType: string,
  entityName: string,
  entityQualifier: string
): ReturnType<typeof error> | null {
  const target = payload?.knowledgeTarget;
  if (!target) return null;
  const typeOk = entityType === target.entityType;
  const nameOk = entityName.trim().toLowerCase() === target.entityName.toLowerCase();
  const qualifierOk =
    entityQualifier.trim().toLowerCase() === (target.entityQualifier ?? '').toLowerCase();
  if (!typeOk || !nameOk || !qualifierOk) {
    const label =
      `${target.entityType}/${target.entityName}` +
      (target.entityQualifier ? ` (${target.entityQualifier})` : '');
    return error(
      t(
        `Die KI-Aufgabe ist serverseitig auf die Entität ${label} beschränkt.`,
        `The AI task is restricted server-side to the entity ${label}.`
      )
    );
  }
  return null;
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
  const inputSchema = z.object(argsSchema);
  server.registerTool(name, { description, inputSchema }, async (args: unknown) => {
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
  });
}

if (requireScope('diary:summarize')) {
  loggedTool(
    'set_diary_summary',
    t('Setzt die Zusammenfassung eines Tagebucheintrags.', 'Sets the summary of a diary entry.'),
    {
      entryId: z.number().int().positive(),
      summary: z.string().min(1).max(500),
    },
    async ({ entryId, summary }) => {
      try {
        const entry = getDiaryEntryWithAccess(entryId);
        if (!entry) return diaryAccessError();
        updateDiaryEntry(entryId, { summary: summary.trim() });
        return success(
          t(`Zusammenfassung für Eintrag ${entryId} gesetzt.`, `Summary set for entry ${entryId}.`)
        );
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Setzen der Zusammenfassung', 'Error while setting the summary')
        );
      }
    }
  );
}

if (requireScope('diary:rewrite')) {
  loggedTool(
    'set_diary_rewrite',
    t(
      'Speichert den umgeschriebenen HTML-Inhalt eines Tagebucheintrags.',
      'Saves the rewritten HTML content of a diary entry.'
    ),
    {
      entryId: z.number().int().positive(),
      html: z.string().min(1),
    },
    async ({ entryId, html }) => {
      try {
        const entry = getDiaryEntryWithAccess(entryId);
        if (!entry) return diaryAccessError();
        writeRewrittenFile(entryId, normalizeToHtml(sanitizeHtml(html)));
        return success(
          t(`Rewrite für Eintrag ${entryId} gespeichert.`, `Rewrite saved for entry ${entryId}.`)
        );
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Speichern des Rewrites', 'Error while saving the rewrite')
        );
      }
    }
  );
}

if (requireScope('diary:draft')) {
  loggedTool(
    'set_session_diary_draft',
    t(
      'Erstellt oder aktualisiert einen KI-Tagebuch-Entwurf aus einer Session. Wenn targetEntryId angegeben ist, wird der Entwurf an einen bestehenden Eintrag angehängt (als KI-Version), sonst wird ein neuer Eintrag angelegt.',
      'Creates or updates an AI diary draft from a session. If targetEntryId is provided, the draft is appended to that existing entry as an AI version; otherwise, a new entry is created.'
    ),
    {
      sessionId: z.number().int().positive(),
      title: z.string().min(1).max(200),
      html: z.string().min(1),
      targetEntryId: z.number().int().positive().optional(),
    },
    async ({ sessionId, title, html, targetEntryId }) => {
      try {
        if (!sessionUserId) {
          return error(t('Kein Benutzerkontext vorhanden', 'No user context is available'));
        }
        const session = getSessionById(sessionId);
        if (!session) {
          return error(
            t(`Session ${sessionId} nicht gefunden.`, `Session ${sessionId} not found.`)
          );
        }
        if (targetEntryId) {
          const entry = getDiaryEntryById(targetEntryId);
          if (!entry || entry.userId !== sessionUserId) return diaryAccessError();
          const updated = applySessionDiaryDraftToEntry(targetEntryId, sessionId, html);
          if (!updated) {
            return error(t('Fehler beim Speichern des Entwurfs', 'Error while saving the draft'));
          }
          return success(
            t(
              `Entwurf für Eintrag ${updated.id} gespeichert.`,
              `Draft saved for entry ${updated.id}.`
            )
          );
        }
        const created = createSessionDiaryDraft(sessionUserId, title, sessionId, html);
        return success(
          t(
            `Neuer Entwurf als Eintrag ${created.id} erstellt.`,
            `New draft created as entry ${created.id}.`
          )
        );
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Speichern des Tagebuch-Entwurfs', 'Error while saving the diary draft')
        );
      }
    }
  );
}

if (requireScope('entity:extract')) {
  loggedTool(
    'link_diary_entity',
    t(
      'Verknüpft eine Entität mit einem Tagebucheintrag. Bei Namensgleichheit muss der Qualifier der gemeinten Entität angegeben werden (siehe list_entities).',
      'Links an entity to a diary entry. For namesakes, the qualifier of the intended entity must be provided (see list_entities).'
    ),
    {
      entryId: z.number().int().positive(),
      type: z.enum(['persons', 'organizations', 'locations', 'items']),
      name: z.string().min(1),
      qualifier: z
        .string()
        .optional()
        .describe(
          t(
            'Unterscheidungs-Qualifier, falls es mehrere Entitäten mit diesem Namen gibt.',
            'Disambiguating qualifier when several entities have this name.'
          )
        ),
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
        else if (type === 'locations') setDiaryEntryLocations(entryId, [...existing]);
        else setDiaryEntryItems(entryId, [...existing]);
        return success(
          t(
            `Entität ${label} mit Eintrag ${entryId} verknüpft.`,
            `Linked entity ${label} to entry ${entryId}.`
          )
        );
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Verknüpfen der Entität', 'Error while linking the entity')
        );
      }
    }
  );
}

if (requireScope('entity:summary')) {
  loggedTool(
    'set_entity_summary',
    t(
      'Setzt die Zusammenfassung und optionale Mini-Zusammenfassung einer Entität. Bei Namensgleichheit muss der Qualifier der Ziel-Entität angegeben werden.',
      'Sets the summary and optional mini-summary of an entity. For namesakes, the qualifier of the target entity must be provided.'
    ),
    {
      type: z.enum(['persons', 'organizations', 'locations', 'items']),
      name: z.string().min(1),
      summary: z.string().min(1),
      miniSummary: z.string().max(200).optional(),
      qualifier: z.string().optional(),
    },
    async ({ type, name, summary, miniSummary, qualifier }) => {
      try {
        const targetError = assertKnowledgeTargetAllowed(type, name, qualifier?.trim() ?? '');
        if (targetError) return targetError;
        const ref = ensureEntityExists(type, name, qualifier?.trim() ?? '');
        setEntitySummary(type, ref.name, summary.trim(), false, miniSummary, ref.qualifier);
        return success(
          t(
            `Zusammenfassung für ${type}/${entityLabel(ref)} gesetzt.`,
            `Summary set for ${type}/${entityLabel(ref)}.`
          )
        );
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Setzen der Zusammenfassung', 'Error while setting the summary')
        );
      }
    }
  );
}

if (requireScope('knowledge:distribute')) {
  loggedTool(
    'create_knowledge',
    t(
      'Erstellt einen Wissenseintrag für eine Entität. Bei Namensgleichheit muss der Qualifier der Ziel-Entität angegeben werden. validFrom/validUntil sind optionale in-game Spieltage (recording_sessions.game_day): damit wird ein zeitgebundener Fakt auf der Chronologie der Entität verankert. Zeitlose Fakten (z. B. "ist eine Elfe") lassen diese Felder weg.',
      'Creates a knowledge entry for an entity. For namesakes, the qualifier of the target entity must be provided. validFrom/validUntil are optional in-game days (recording_sessions.game_day), anchoring a time-bound fact to the entity\'s chronology. Omit these fields for timeless facts (for example, "is an elf").'
    ),
    {
      type: z.enum(['persons', 'organizations', 'locations', 'items']),
      name: z.string().min(1),
      content: z.string().min(1),
      title: z.string().optional(),
      qualifier: z.string().optional(),
      validFrom: z.number().int().optional(),
      validUntil: z.number().int().optional(),
    },
    async ({ type, name, content, title, qualifier, validFrom, validUntil }) => {
      try {
        const targetError = assertKnowledgeTargetAllowed(type, name, qualifier?.trim() ?? '');
        if (targetError) return targetError;
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
        return success(
          t(
            `Wissenseintrag ${entry.id} für ${type}/${entityLabel(ref)} erstellt.`,
            `Knowledge entry ${entry.id} created for ${type}/${entityLabel(ref)}.`
          )
        );
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t(
                'Fehler beim Erstellen des Wissenseintrags',
                'Error while creating the knowledge entry'
              )
        );
      }
    }
  );

  loggedTool(
    'delete_knowledge',
    t(
      'Markiert einen Wissenseintrag als gelöscht (Widerruf: der Fakt war falsch bzw. trifft nie zu). Für zeitgebundene Änderungen (der Fakt war wahr, gilt aber ab einem Spieltag nicht mehr) end_knowledge verwenden.',
      'Marks a knowledge entry as deleted (retraction: the fact was false or never applied). For time-bound changes (the fact was true but no longer applies from a game day onward), use end_knowledge.'
    ),
    {
      id: z.number().int().positive(),
      reason: z.string().optional(),
    },
    async ({ id, reason }) => {
      try {
        const existing = getEntityKnowledgeEntry(id);
        if (!existing) {
          return error(t('Wissenseintrag nicht gefunden', 'Knowledge entry not found'));
        }
        const targetError = assertKnowledgeTargetAllowed(
          existing.entityType,
          existing.entityName,
          existing.entityQualifier ?? ''
        );
        if (targetError) return targetError;
        markEntityKnowledgeDeleted(id, reason?.trim() || null);
        return success(
          t(
            `Wissenseintrag ${id} als gelöscht markiert.`,
            `Knowledge entry ${id} marked as deleted.`
          )
        );
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t(
                'Fehler beim Löschen des Wissenseintrags',
                'Error while deleting the knowledge entry'
              )
        );
      }
    }
  );

  loggedTool(
    'end_knowledge',
    t(
      'Beendet einen zeitgebundenen Wissenseintrag: ab dem angegebenen in-game Spieltag gilt der Fakt nicht mehr, bleibt aber als Historie sichtbar. Verwende dies statt delete_knowledge, wenn sich ein Fakt über die Zeit ändert (z. B. "X steht A gut", nach einem Zwischenfall aber nicht mehr).',
      'Ends a time-bound knowledge entry: from the specified in-game day the fact no longer applies but remains visible as history. Use this instead of delete_knowledge when a fact changes over time (for example, "X gets along with A", but no longer does after an incident).'
    ),
    {
      id: z.number().int().positive(),
      until: z.number().int().positive(),
      reason: z.string().optional(),
    },
    async ({ id, until, reason }) => {
      try {
        const existing = getEntityKnowledgeEntry(id);
        if (!existing) {
          return error(t('Wissenseintrag nicht gefunden', 'Knowledge entry not found'));
        }
        if (existing.status !== 'active') {
          return error(
            t('Nur aktive Einträge können beendet werden', 'Only active entries can be ended')
          );
        }
        const targetError = assertKnowledgeTargetAllowed(
          existing.entityType,
          existing.entityName,
          existing.entityQualifier ?? ''
        );
        if (targetError) return targetError;
        markEntityKnowledgeTimelineEnd(id, until, reason?.trim() || null);
        return success(
          t(
            `Wissenseintrag ${id} bis Spieltag ${until} beendet.`,
            `Knowledge entry ${id} ended through game day ${until}.`
          )
        );
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Beenden des Wissenseintrags', 'Error while ending the knowledge entry')
        );
      }
    }
  );
}

if (requireScope('diary:read')) {
  loggedTool(
    'get_diary_entry',
    t(
      'Liefert einen bestimmten Tagebucheintrag inklusive Titel, Inhalt, Zusammenfassung und verknüpfter Entitäten.',
      'Returns a specific diary entry including its title, content, summary, and linked entities.'
    ),
    {
      entryId: z.number().int().positive(),
    },
    async ({ entryId }) => {
      try {
        const entry = getDiaryEntryWithAccess(entryId);
        if (!entry) return diaryAccessError();
        if (sessionArcId !== null && entry.arcId !== sessionArcId) {
          return error(
            t(
              'Der Eintrag gehört nicht zum Story Arc dieser Aufgabe; die Kontextabfragen sind arc-beschränkt.',
              'This entry does not belong to the story arc for this task; context queries are arc-restricted.'
            )
          );
        }
        const lines = [
          `ID: ${entry.id}`,
          t(`Titel: ${entry.title}`, `Title: ${entry.title}`),
          t(`Datum: ${entry.createdAt}`, `Date: ${entry.createdAt}`),
          t(`Zusammenfassung: ${entry.summary ?? '-'}`, `Summary: ${entry.summary ?? '-'}`),
          t(
            `Personen: ${entry.persons.join(', ') || '-'}`,
            `People: ${entry.persons.join(', ') || '-'}`
          ),
          t(
            `Organisationen: ${entry.organizations.join(', ') || '-'}`,
            `Organizations: ${entry.organizations.join(', ') || '-'}`
          ),
          t(
            `Orte: ${entry.locations.join(', ') || '-'}`,
            `Locations: ${entry.locations.join(', ') || '-'}`
          ),
          '',
          t('Inhalt (Plain Text):', 'Content (plain text):'),
          stripHtml(entry.content),
        ];
        return success(lines.join('\n'));
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Laden des Tagebucheintrags', 'Error while loading the diary entry')
        );
      }
    }
  );

  loggedTool(
    'search_diary_entries',
    t(
      'Sucht nach Tagebucheinträgen, die einen Suchbegriff im Titel oder Inhalt enthalten.',
      'Searches diary entries whose title or content contains a search term.'
    ),
    {
      query: z.string().min(1),
      limit: z.number().int().positive().max(20).optional(),
    },
    async ({ query, limit }) => {
      try {
        if (!canReadAllDiaries && !sessionUserId) {
          return error(t('Kein Benutzerkontext vorhanden', 'No user context is available'));
        }
        const diaryUserId = canReadAllDiaries ? undefined : (sessionUserId ?? undefined);
        const entries = searchDiaryEntries(
          query,
          diaryUserId,
          limit ?? 5,
          sessionArcId ?? undefined
        );
        if (entries.length === 0) {
          return success(t('Keine Tagebucheinträge gefunden.', 'No diary entries found.'));
        }
        const lines = entries.map((e) => {
          const plain = stripHtml(e.content);
          return `ID ${e.id} | ${e.createdAt} | ${e.title}\n${plain.slice(0, 300)}${plain.length > 300 ? '...' : ''}`;
        });
        return success(lines.join('\n\n'));
      } catch (err) {
        return error(
          err instanceof Error ? err.message : t('Fehler bei der Suche', 'Error while searching')
        );
      }
    }
  );

  loggedTool(
    'get_previous_diary_entries',
    t(
      'Liefert die vorherigen Tagebucheinträge desselben Autors vor einem bestimmten Eintrag.',
      'Returns earlier diary entries by the same author before a specific entry.'
    ),
    {
      entryId: z.number().int().positive(),
      limit: z.number().int().positive().max(10).optional(),
    },
    async ({ entryId, limit }) => {
      try {
        const entry = getDiaryEntryWithAccess(entryId);
        if (!entry) return diaryAccessError();
        const entries = listPreviousDiaryEntriesByUser(
          entry.userId,
          entry.createdAt,
          limit ?? 3,
          sessionArcId ?? undefined
        );
        if (entries.length === 0) {
          return success(
            t('Keine vorherigen Tagebucheinträge gefunden.', 'No earlier diary entries found.')
          );
        }
        const lines = entries.map((e) => {
          const plain = stripHtml(e.content);
          return `ID ${e.id} | ${e.createdAt} | ${e.title}\n${plain.slice(0, 300)}${plain.length > 300 ? '...' : ''}`;
        });
        return success(lines.join('\n\n'));
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Laden der vorherigen Einträge', 'Error while loading earlier entries')
        );
      }
    }
  );

  loggedTool(
    'list_user_diary_entries',
    t(
      'Listet die Tagebucheinträge des aktuellen Benutzers mit Titel, Datum und Inhaltsvorschau auf.',
      "Lists the current user's diary entries with title, date, and content preview."
    ),
    {
      limit: z.number().int().positive().max(50).optional(),
    },
    async ({ limit }) => {
      try {
        if (!sessionUserId) {
          return error(t('Kein Benutzerkontext vorhanden', 'No user context is available'));
        }
        const entries = listDiaryEntryHeadlinesByUser(
          sessionUserId,
          limit ?? 20,
          sessionArcId ?? undefined
        );
        if (entries.length === 0) {
          return success(t('Keine Tagebucheinträge gefunden.', 'No diary entries found.'));
        }
        const lines = entries.map((e) => {
          const preview = e.content.length > 0 ? e.content : t('(leerer Eintrag)', '(empty entry)');
          return `ID ${e.id} | ${e.createdAt} | ${e.title}\n${preview}`;
        });
        return success(lines.join('\n\n'));
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Laden der Tagebucheinträge', 'Error while loading diary entries')
        );
      }
    }
  );
}

if (requireScope('entity:read')) {
  loggedTool(
    'list_entities',
    t(
      'Listet alle bekannten Entitäten (Personen, Organisationen, Orte, namenhafte Gegenstände) mit Qualifier und Mini-Zusammenfassung auf. Optional gefiltert nach Typ.',
      'Lists all known entities (people, organizations, locations, and named items) with qualifiers and mini-summaries. Optionally filtered by type.'
    ),
    {
      type: z.enum(['persons', 'organizations', 'locations', 'items']).optional(),
      limit: z.number().int().positive().max(200).optional(),
    },
    async ({ type, limit }) => {
      try {
        const refs = listAllEntityRefs();
        const all = [
          ...refs.persons.map((ref) => ({ type: 'persons' as const, ref })),
          ...refs.organizations.map((ref) => ({ type: 'organizations' as const, ref })),
          ...refs.locations.map((ref) => ({ type: 'locations' as const, ref })),
          ...refs.items.map((ref) => ({ type: 'items' as const, ref })),
        ];
        const filtered = type ? all.filter((e) => e.type === type) : all;
        const limited = filtered.slice(0, limit ?? 100);
        if (limited.length === 0) {
          return success(t('Keine Entitäten gefunden.', 'No entities found.'));
        }
        const lines = limited.map(({ type: entityType, ref }) => {
          const summary = getEntitySummary(entityType, ref.name, ref.qualifier);
          const mini = summary?.miniSummary ?? summary?.summary ?? null;
          const suffix = mini ? ` – ${truncateText(mini.replace(/\s+/g, ' ').trim(), 120)}` : '';
          return `- ${entityType}: ${entityLabel(ref)}${suffix}`;
        });
        return success(lines.join('\n'));
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Laden der Entitäten', 'Error while loading entities')
        );
      }
    }
  );

  loggedTool(
    'get_entity',
    t(
      'Liefert Zusammenfassung, aktuell gültiges Wissen, nicht mehr gültige Wissens-Historie und verknüpfte Tagebucheinträge (inkl. Spieltag) zu einer bestimmten Entität. Bei Namensgleichheit muss der Qualifier angegeben werden. includeHistory=false blendet die Historie aus; includeDiaryEntries=false blendet die Tagebucheinträge aus.',
      'Returns the summary, currently valid knowledge, no-longer-valid knowledge history, and linked diary entries (including game day) for a specific entity. For namesakes, the qualifier must be provided. includeHistory=false omits history; includeDiaryEntries=false omits diary entries.'
    ),
    {
      type: z.enum(['persons', 'organizations', 'locations', 'items']),
      name: z.string().min(1),
      qualifier: z.string().optional(),
      includeDiaryEntries: z.boolean().optional(),
      includeHistory: z.boolean().optional(),
    },
    async ({ type, name, qualifier, includeDiaryEntries, includeHistory }) => {
      try {
        const canonicalRef = findEntityCanonical(type, name, qualifier?.trim() ?? '');
        if (!canonicalRef) {
          return error(
            t(
              `Entität ${type}/${name} nicht gefunden. Verwende list_entities, um passende Namen (und Qualifier) zu finden.`,
              `Entity ${type}/${name} not found. Use list_entities to find matching names (and qualifiers).`
            )
          );
        }
        const label = entityLabel(canonicalRef);
        const summary = getEntitySummary(type, canonicalRef.name, canonicalRef.qualifier);
        const currentGameDay = getCurrentGameDay();
        // In arc-scoped runs, knowledge and linked diary entries are limited
        // to the arc's derived game-day range / arc membership.
        const arcRange = sessionArcId !== null ? getStoryArcDayRange(sessionArcId) : null;
        const inArc = (entry: { validFrom: number | null; validUntil: number | null }): boolean =>
          arcRange === null || knowledgeOverlapsArcRange(entry, arcRange);
        const knowledge = listActiveEntityKnowledge(
          type,
          canonicalRef.name,
          canonicalRef.qualifier,
          currentGameDay
        ).filter(inArc);
        const diaryEntries =
          includeDiaryEntries !== false
            ? listDiaryEntryContentsByEntity(
                type,
                canonicalRef.name,
                canReadAllDiaries ? undefined : (sessionUserId ?? '__no_user__'),
                canonicalRef.qualifier,
                sessionArcId ?? undefined
              )
            : [];

        const lines: string[] = [t(`Entität: ${label} (${type})`, `Entity: ${label} (${type})`)];
        lines.push(
          t(
            `Aktueller Spieltag der Kampagne: ${currentGameDay ?? 'unbekannt (noch kein Spieltag gesetzt)'}`,
            `Current campaign game day: ${currentGameDay ?? 'unknown (no game day has been set yet)'}`
          )
        );
        lines.push(
          t(`Zusammenfassung: ${summary?.summary ?? '-'}`, `Summary: ${summary?.summary ?? '-'}`)
        );
        lines.push(
          t(
            `Mini-Zusammenfassung: ${summary?.miniSummary ?? '-'}`,
            `Mini-summary: ${summary?.miniSummary ?? '-'}`
          )
        );

        if (knowledge.length > 0) {
          lines.push('');
          lines.push(t('Wissen (aktuell gültig):', 'Knowledge (currently valid):'));
          for (const entry of knowledge) {
            const title = entry.title ? `${entry.title}: ` : '';
            // valid_until is EXCLUSIVE: the fact holds up to (validUntil - 1).
            const window =
              entry.validFrom !== null || entry.validUntil !== null
                ? entry.validUntil !== null
                  ? t(
                      ` [ab Spieltag ${entry.validFrom ?? '…'} bis Tag ${entry.validUntil - 1}]`,
                      ` [from game day ${entry.validFrom ?? '…'} through day ${entry.validUntil - 1}]`
                    )
                  : t(
                      ` [ab Spieltag ${entry.validFrom ?? '…'}]`,
                      ` [from game day ${entry.validFrom ?? '…'}]`
                    )
                : '';
            lines.push(`- ${title}${entry.content}${window}`);
          }
        }

        if (includeHistory !== false) {
          const activeIds = new Set(knowledge.map((k) => k.id));
          const history = listEntityKnowledge(
            type,
            canonicalRef.name,
            canonicalRef.qualifier
          ).filter((k) => !activeIds.has(k.id) && inArc(k));
          if (history.length > 0) {
            lines.push('');
            lines.push(t('Historie (nicht mehr gültig):', 'History (no longer valid):'));
            for (const entry of history.slice(0, 30)) {
              const title = entry.title ? `${entry.title}: ` : '';
              const window =
                entry.validFrom !== null || entry.validUntil !== null
                  ? entry.validUntil !== null
                    ? t(
                        ` [gültig Tag ${entry.validFrom ?? '…'}–${entry.validUntil - 1}]`,
                        ` [valid on day ${entry.validFrom ?? '…'}–${entry.validUntil - 1}]`
                      )
                    : t(
                        ` [ab Tag ${entry.validFrom ?? '…'}]`,
                        ` [from day ${entry.validFrom ?? '…'}]`
                      )
                  : '';
              const state =
                entry.status === 'deleted' ? t('gelöscht', 'deleted') : t('beendet', 'ended');
              const reason = entry.statusReason ? ` – ${entry.statusReason}` : '';
              lines.push(`- ${title}${entry.content}${window} (${state}${reason})`);
            }
          }
        }

        if (diaryEntries.length > 0) {
          lines.push('');
          lines.push(t('Verknüpfte Tagebucheinträge:', 'Linked diary entries:'));
          for (const entry of diaryEntries.slice(0, 5)) {
            const plain = stripHtml(entry.content);
            lines.push(
              t(
                `ID ${entry.id} | Spieltag ${entry.gameDay ?? '?'} | ${entry.createdAt} | ${entry.title}`,
                `ID ${entry.id} | game day ${entry.gameDay ?? '?'} | ${entry.createdAt} | ${entry.title}`
              )
            );
            lines.push(`${plain.slice(0, 200)}${plain.length > 200 ? '...' : ''}`);
          }
        }

        return success(lines.join('\n'));
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Laden der Entität', 'Error while loading the entity')
        );
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
    t(`Datum: ${session.startedAt}`, `Date: ${session.startedAt}`),
    '',
    t('Kurze Zusammenfassung:', 'Short summary:'),
    session.summary ?? t('(noch nicht erstellt)', '(not created yet)'),
    '',
    t('Lange Zusammenfassung:', 'Long summary:'),
    session.longSummary ?? t('(noch nicht erstellt)', '(not created yet)'),
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
    t(
      'Speichert die ermittelten Start- und Endzeitpunkte der eigentlichen Spiel-Session innerhalb einer Aufnahme. Sekundenangaben sind Offsets vom Beginn der Aufnahme (0 Sekunden = Aufnahmebeginn, [HH:MM:SS] im Transkript).',
      'Saves the detected start and end times of the actual game session within a recording. Seconds are offsets from the beginning of the recording (0 seconds = recording start, [HH:MM:SS] in the transcript).'
    ),
    {
      sessionId: z.number().int().positive(),
      startSeconds: z.number().min(0),
      endSeconds: z.number().min(0),
    },
    async ({ sessionId, startSeconds, endSeconds }) => {
      try {
        if (endSeconds <= startSeconds) {
          return error(
            t(
              'endSeconds muss größer als startSeconds sein.',
              'endSeconds must be greater than startSeconds.'
            )
          );
        }
        const session = getSessionById(sessionId);
        if (!session) {
          return error(
            t(`Session ${sessionId} nicht gefunden.`, `Session ${sessionId} not found.`)
          );
        }
        updateSession(sessionId, {
          gameStartSeconds: startSeconds,
          gameEndSeconds: endSeconds,
          gameBoundaryDetectedAt: new Date().toISOString(),
        });
        return success(
          t(
            `Spielzeitgrenzen für Session ${sessionId} gespeichert: ${startSeconds}s bis ${endSeconds}s.`,
            `Game boundaries for session ${sessionId} saved: ${startSeconds}s to ${endSeconds}s.`
          )
        );
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Speichern der Spielzeitgrenzen', 'Error while saving game boundaries')
        );
      }
    }
  );
}

if (requireScope('recording:game-day')) {
  loggedTool(
    'set_session_game_day',
    t(
      'Setzt die betroffenen In-Game-Spieltage einer Aufnahme-Session (gameDay bis gameDayEnd, inklusiv). Ein einzelner Tag hat gameDayEnd == gameDay oder weglassen. Maximal 30 Tage Spanne.',
      'Sets the in-game days affected by a recording session (gameDay through gameDayEnd, inclusive). A single day has gameDayEnd == gameDay or omits it. The maximum span is 30 days.'
    ),
    {
      sessionId: z.number().int().positive(),
      gameDay: z.number().int().positive(),
      gameDayEnd: z.number().int().positive().optional(),
    },
    async ({ sessionId, gameDay, gameDayEnd }) => {
      try {
        if (payload?.recordingSessionId !== sessionId) {
          return error(
            t(
              'Der MCP-Token ist nicht für diese Session autorisiert.',
              'The MCP token is not authorized for this session.'
            )
          );
        }
        const session = getSessionById(sessionId);
        if (!session) {
          return error(
            t(`Session ${sessionId} nicht gefunden.`, `Session ${sessionId} not found.`)
          );
        }
        const start = gameDay;
        const end = gameDayEnd ?? start;
        if (end < start) {
          return error(
            t('gameDayEnd darf nicht vor gameDay liegen.', 'gameDayEnd must not be before gameDay.')
          );
        }
        if (end - start > 30) {
          return error(t('Zeitraum zu groß (max 30 Tage).', 'Range too large (maximum 30 days).'));
        }
        setSessionGameDayRange(sessionId, start, end);
        return success(
          t(
            `Spieltag für Session ${sessionId} gesetzt: ${start}${end !== start ? `–${end}` : ''}.`,
            `Game day for session ${sessionId} set: ${start}${end !== start ? `–${end}` : ''}.`
          )
        );
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Setzen des Spieltags', 'Error while setting the game day')
        );
      }
    }
  );
}

if (requireScope('recording:read')) {
  loggedTool(
    'list_recent_sessions',
    t(
      'Listet die letzten Aufnahme-Sessions (ohne Transkript) mit ID, Name und Datum auf – Einstieg für Session-Verifikation ohne bekannte sessionId (z. B. für Kreide-Code 000003). Nutze danach get_session_summary(sessionId) für Details.',
      'Lists recent recording sessions (without transcripts) with ID, name, and date as an entry point for session verification without a known sessionId (for example, chalk code 000003). Then use get_session_summary(sessionId) for details.'
    ),
    {
      limit: z.number().int().positive().max(20).optional(),
    },
    async ({ limit }) => {
      try {
        const { listSessions } = await import('../repositories/recordings.js');
        const sessions = listSessions(sessionArcId ?? undefined);
        const limited = sessions.slice(0, limit ?? 5);
        if (limited.length === 0) {
          return success(t('Keine Sessions gefunden.', 'No sessions found.'));
        }
        const lines = limited.map((s) =>
          t(
            `ID ${s.id} | ${s.startedAt} | ${s.name} | Status ${s.status} | GameDay ${s.gameDay ?? '?'}${s.gameDayEnd && s.gameDayEnd !== s.gameDay ? `-${s.gameDayEnd}` : ''}`,
            `ID ${s.id} | ${s.startedAt} | ${s.name} | status ${s.status} | game day ${s.gameDay ?? '?'}${s.gameDayEnd && s.gameDayEnd !== s.gameDay ? `-${s.gameDayEnd}` : ''}`
          )
        );
        return success(lines.join('\n'));
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Laden der Sessions', 'Error while loading sessions')
        );
      }
    }
  );

  loggedTool(
    'get_session_summary',
    t(
      'Liefert die kurze und lange Zusammenfassung einer bestimmten Aufnahme-Session.',
      'Returns the short and long summary of a specific recording session.'
    ),
    {
      sessionId: z.number().int().positive(),
    },
    async ({ sessionId }) => {
      try {
        const session = getSessionSummaryById(sessionId);
        if (!session) {
          return error(
            t(`Session ${sessionId} nicht gefunden.`, `Session ${sessionId} not found.`)
          );
        }
        if (sessionArcId !== null && (session.arcId ?? null) !== sessionArcId) {
          return error(
            t(
              'Die Session gehört nicht zum Story Arc dieser Aufgabe; die Kontextabfragen sind arc-beschränkt.',
              'This session does not belong to the story arc for this task; context queries are arc-restricted.'
            )
          );
        }
        return success(formatSessionSummary(session));
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t(
                'Fehler beim Laden der Session-Zusammenfassung',
                'Error while loading the session summary'
              )
        );
      }
    }
  );

  loggedTool(
    'get_previous_session_summaries',
    t(
      'Liefert die Zusammenfassungen der vorherigen Aufnahme-Sessions (absteigend nach Datum).',
      'Returns summaries of previous recording sessions (newest first).'
    ),
    {
      sessionId: z.number().int().positive(),
      limit: z.number().int().positive().max(10).optional(),
    },
    async ({ sessionId, limit }) => {
      try {
        const sessions = listPreviousSessionSummaries(
          sessionId,
          limit ?? 5,
          sessionArcId ?? undefined
        );
        if (sessions.length === 0) {
          return success(t('Keine vorherigen Sessions gefunden.', 'No previous sessions found.'));
        }
        return success(sessions.map(formatSessionSummary).join('\n\n---\n\n'));
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t(
                'Fehler beim Laden der vorherigen Sessions',
                'Error while loading previous sessions'
              )
        );
      }
    }
  );
}

if (requireScope('recording:summarize')) {
  loggedTool(
    'set_session_summary',
    t(
      'Setzt die kurze Zusammenfassung (Stichpunkte, max. 500 Zeichen) einer Aufnahme-Session.',
      'Sets the short summary (bullet points, maximum 500 characters) of a recording session.'
    ),
    {
      sessionId: z.number().int().positive(),
      summary: z.string().min(1).max(500),
    },
    async ({ sessionId, summary }) => {
      try {
        const session = getSessionById(sessionId);
        if (!session) {
          return error(
            t(`Session ${sessionId} nicht gefunden.`, `Session ${sessionId} not found.`)
          );
        }
        updateSession(sessionId, {
          summary: summary.trim(),
          summaryGeneratedAt: new Date().toISOString(),
        });
        return success(
          t(
            `Kurze Zusammenfassung für Session ${sessionId} gesetzt.`,
            `Short summary for session ${sessionId} set.`
          )
        );
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Setzen der Zusammenfassung', 'Error while setting the summary')
        );
      }
    }
  );

  loggedTool(
    'set_session_long_summary',
    t(
      'Setzt die ausführliche HTML-Zusammenfassung einer Aufnahme-Session.',
      'Sets the detailed HTML summary of a recording session.'
    ),
    {
      sessionId: z.number().int().positive(),
      longSummary: z.string().min(1),
    },
    async ({ sessionId, longSummary }) => {
      try {
        const session = getSessionById(sessionId);
        if (!session) {
          return error(
            t(`Session ${sessionId} nicht gefunden.`, `Session ${sessionId} not found.`)
          );
        }
        updateSession(sessionId, {
          longSummary: sanitizeHtml(longSummary).trim(),
          longSummaryGeneratedAt: new Date().toISOString(),
        });
        return success(
          t(
            `Lange Zusammenfassung für Session ${sessionId} gesetzt.`,
            `Long summary for session ${sessionId} set.`
          )
        );
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t(
                'Fehler beim Setzen der langen Zusammenfassung',
                'Error while saving the long summary'
              )
        );
      }
    }
  );
}

if (requireScope('timeline:write')) {
  // The campaign timeline: notable events extracted from a session's
  // summaries. Like the session summaries, results are written by the MCP
  // handler into the database, not parsed from the AI's text output.
  loggedTool(
    'set_timeline_events',
    t(
      'Speichert die nennenswerten Ereignisse (Hauptevents) einer Session für die Kampagnen-Zeitleiste. Ersetzt alle bisherigen Ereignisse dieser Session. Die Spieltage (gameDay) beziehen sich auf die Ingame-Kampagnen-Chronologie.',
      'Saves the notable main events of a session for the campaign timeline. Replaces all previous events for this session. Game days refer to the in-game campaign chronology.'
    ),
    {
      sessionId: z.number().int().positive(),
      events: z
        .array(
          z.object({
            gameDay: z
              .number()
              .int()
              .positive()
              .describe(t('Ingame-Spieltag des Ereignisses.', 'In-game day of the event.')),
            title: z
              .string()
              .min(1)
              .max(200)
              .describe(
                t(
                  'Prägnanter Titel des Ereignisses (ein Satz, Deutsch).',
                  'Concise title of the event (one sentence, in English).'
                )
              ),
            description: z
              .string()
              .max(2000)
              .optional()
              .describe(
                t(
                  'Knappe HTML-Beschreibung (<p>…), was geschah und warum es wichtig war.',
                  'Brief HTML description (<p>…) of what happened and why it mattered.'
                )
              ),
            scenes: z
              .array(
                z.object({
                  gameDay: z.number().int().positive().optional(),
                  title: z.string().min(1).max(200),
                  description: z.string().max(2000).optional(),
                })
              )
              .max(12)
              .describe(
                t(
                  'Szenen/Zwischenereignisse des Spieltags für den Mini-Zeitstrahl.',
                  'Scenes or intermediate events of the game day for the mini-timeline.'
                )
              ),
          })
        )
        .max(30)
        .describe(
          t(
            'Nur nennenswerte Ereignisse (Kämpfe, Entscheidungen, Treffen, Funde, Wendepunkte) - kein Ereignis pro Spieltag. Bei keinem nennenswerten Geschehen ein leeres Array senden.',
            'Only notable events (battles, decisions, meetings, discoveries, turning points), not one event per game day. Send an empty array when there is nothing notable.'
          )
        ),
    },
    async ({ sessionId, events }) => {
      try {
        if (payload?.recordingSessionId !== sessionId) {
          return error(
            t(
              'Der MCP-Token ist nicht für diese Session autorisiert.',
              'The MCP token is not authorized for this session.'
            )
          );
        }
        const session = getSessionById(sessionId);
        if (!session) {
          return error(
            t(`Session ${sessionId} nicht gefunden.`, `Session ${sessionId} not found.`)
          );
        }
        const sanitized = events.map((event): TimelineEventInput => ({
          gameDay: event.gameDay,
          title: event.title.trim(),
          description: event.description ? sanitizeHtml(event.description).trim() : null,
          scenes: event.scenes.map((scene) => ({
            gameDay: scene.gameDay ?? event.gameDay,
            title: scene.title.trim(),
            description: scene.description ? sanitizeHtml(scene.description).trim() : null,
          })),
        }));
        replaceSessionEvents(sessionId, sanitized);
        return success(
          t(
            `${sanitized.length} Zeitleisten-Ereignisse für Session ${sessionId} gespeichert.`,
            `${sanitized.length} timeline events for session ${sessionId} saved.`
          )
        );
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t(
                'Fehler beim Speichern der Zeitleisten-Ereignisse',
                'Error while saving timeline events'
              )
        );
      }
    }
  );
}

if (requireScope('bingo:read')) {
  loggedTool(
    'get_bingo_state',
    t(
      'Liefert den aktuellen Bingo-Zustand: Spielfeldgröße, Status, Aufgaben getrennt nach Spieler- und DM-Pool, ausstehende Vorschläge und kürzlich abgelehnte Vorschläge.',
      'Returns the current Bingo state: board size, status, tasks separated into player and DM pools, pending suggestions, and recently rejected suggestions.'
    ),
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
          tasks.length > 0 ? tasks.map((t) => `- ${t.text}`) : [t('Keine', 'None')];

        const lines = [
          t(
            `Spielfeldgröße: ${game.gridSize}x${game.gridSize}`,
            `Board size: ${game.gridSize}x${game.gridSize}`
          ),
          t(`Status: ${game.status}`, `Status: ${game.status}`),
          '',
          t(
            'Bereits vorhandene Bingo-Aufgaben im SPIELER-POOL:',
            'Existing Bingo tasks in the PLAYER POOL:'
          ),
          ...taskLines(playerTasks),
          '',
          t(
            'Bereits vorhandene Bingo-Aufgaben im DM-POOL (perspektive Dungeon Master):',
            'Existing Bingo tasks in the DM POOL (Dungeon Master perspective):'
          ),
          ...taskLines(dmTasks),
          '',
          t(
            'Ausstehende Vorschläge im Spieler-Pool (nicht erneut vorschlagen):',
            'Pending suggestions in the player pool (do not suggest again):'
          ),
          ...(pendingPlayerSuggestions.length > 0
            ? pendingPlayerSuggestions.map((t) => `- ${t}`)
            : [t('Keine', 'None')]),
          '',
          t(
            'Ausstehende Vorschläge im DM-Pool (nicht erneut vorschlagen):',
            'Pending suggestions in the DM pool (do not suggest again):'
          ),
          ...(pendingDmSuggestions.length > 0
            ? pendingDmSuggestions.map((t) => `- ${t}`)
            : [t('Keine', 'None')]),
          '',
          t(
            'Zuletzt abgelehnte Vorschläge im Spieler-Pool (nicht erneut vorschlagen):',
            'Recently rejected suggestions in the player pool (do not suggest again):'
          ),
          ...(rejectedPlayerSuggestions.length > 0
            ? rejectedPlayerSuggestions.map((t) => `- ${t}`)
            : [t('Keine', 'None')]),
          '',
          t(
            'Zuletzt abgelehnte Vorschläge im DM-Pool (nicht erneut vorschlagen):',
            'Recently rejected suggestions in the DM pool (do not suggest again):'
          ),
          ...(rejectedDmSuggestions.length > 0
            ? rejectedDmSuggestions.map((t) => `- ${t}`)
            : [t('Keine', 'None')]),
        ];

        return success(lines.join('\n'));
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t('Fehler beim Laden des Bingo-Zustands', 'Error while loading the Bingo state')
        );
      }
    }
  );
}

if (requireScope('bingo:write')) {
  loggedTool(
    'submit_bingo_suggestions',
    t(
      'Übergibt generierte Bingo-Vorschläge für einen Batch. Akzeptiert eine batchId und ein Array aus Aufgabentexten.',
      'Submits generated Bingo suggestions for a batch. Accepts a batchId and an array of task texts.'
    ),
    {
      batchId: z
        .string()
        .describe(
          t('Die Batch-ID, die im Prompt übergeben wurde.', 'The batch ID supplied in the prompt.')
        ),
      suggestions: z
        .array(z.string())
        .describe(t('Array mit Bingo-Aufgabentexten.', 'Array of Bingo task texts.')),
    },
    async ({ batchId, suggestions }: { batchId: string; suggestions: string[] }) => {
      try {
        const batch = getBingoSuggestionBatch(batchId);
        if (!batch) {
          return error(t(`Batch ${batchId} nicht gefunden.`, `Batch ${batchId} not found.`));
        }
        if (batch.status !== 'pending') {
          return error(
            t(
              `Batch ${batchId} ist bereits ${batch.status}.`,
              `Batch ${batchId} is already ${batch.status}.`
            )
          );
        }
        const normalized = suggestions
          .map((text) => text.trim())
          .filter((text) => text.length > 0)
          .map((text) => ({ text, source: 'ai' }));
        submitBingoSuggestionBatch(batchId, normalized);
        return success(
          t(
            `${normalized.length} Bingo-Vorschläge für Batch ${batchId} übergeben.`,
            `${normalized.length} Bingo suggestions submitted for batch ${batchId}.`
          )
        );
      } catch (err) {
        return error(
          err instanceof Error
            ? err.message
            : t(
                'Fehler beim Übergeben der Bingo-Vorschläge',
                'Error while submitting Bingo suggestions'
              )
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
