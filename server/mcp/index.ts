import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import { runMigrations } from '../migrations.js';
import '../database.js';
import { stripHtml } from '../ai/rewrite.js';
import { getSessionById } from '../repositories/recordings.js';
import { writeImprovedTranscript } from '../sessionFiles.js';
import {
  ensureEntityExists,
  findEntityCanonicalName,
  getDiaryEntryById,
  getEntryEntities,
  listAllEntityNames,
  listDiaryEntryContentsByEntity,
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

if (requireScope('diary:summarize')) {
  server.tool(
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
  server.tool(
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

if (requireScope('session:read')) {
  server.tool(
    'get_session_transcript',
    'Liefert das aktuelle Transkript einer Sessions-Aufnahme.',
    {
      sessionId: z.number().int().positive(),
    },
    async ({ sessionId }) => {
      try {
        if (!sessionIsAdmin) return error('Nur Admins dürfen Transkripte lesen');
        const session = getSessionById(sessionId);
        if (!session) return error('Session nicht gefunden');
        if (!session.transcript) return error('Kein Transkript vorhanden');
        return success(session.transcript);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Laden des Transkripts');
      }
    },
  );
}

if (requireScope('session:rewrite')) {
  server.tool(
    'set_session_transcript',
    'Speichert das verbesserte Transkript einer Sessions-Aufnahme.',
    {
      sessionId: z.number().int().positive(),
      text: z.string().min(1),
    },
    async ({ sessionId, text }) => {
      try {
        if (!sessionIsAdmin) return error('Nur Admins dürfen Transkripte verändern');
        if (!writeImprovedTranscript(sessionId, text)) {
          return error('Session nicht gefunden');
        }
        return success(`Transkript für Session ${sessionId} gespeichert.`);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Speichern des Transkripts');
      }
    },
  );
}

if (requireScope('entity:extract')) {
  server.tool(
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
  server.tool(
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
  server.tool(
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

  server.tool(
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
  server.tool(
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

  server.tool(
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

  server.tool(
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
}

if (requireScope('entity:read')) {
  server.tool(
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

  server.tool(
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('MCP server connected on stdio');
}

main().catch((err) => {
  log.error('Fatal error in MCP server:', err);
  process.exit(1);
});
