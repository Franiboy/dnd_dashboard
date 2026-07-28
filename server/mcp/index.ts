import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import { runMigrations } from '../migrations.js';
import '../database.js';
import {
  ensureEntityExists,
  getEntryEntities,
  setDiaryEntryLocations,
  setDiaryEntryOrganizations,
  setDiaryEntryPersons,
  updateDiaryEntry,
} from '../repositories/diary.js';
import {
  createEntityKnowledge,
  getEntityKnowledgeEntry,
  markEntityKnowledgeDeleted,
} from '../repositories/entityKnowledge.js';
import { setEntitySummary } from '../repositories/entitySummaries.js';
import { writeRewrittenFile } from '../diaryFiles.js';
import { normalizeToHtml } from '../ai/rewrite.js';
import { verifyMcpSessionToken, type McpScope } from './tokens.js';

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
        writeRewrittenFile(entryId, normalizeToHtml(html));
        return success(`Rewrite für Eintrag ${entryId} gespeichert.`);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Fehler beim Speichern des Rewrites');
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
    'Setzt die Zusammenfassung einer Entität.',
    {
      type: z.enum(['persons', 'organizations', 'locations']),
      name: z.string().min(1),
      summary: z.string().min(1),
    },
    async ({ type, name, summary }) => {
      try {
        const canonical = ensureEntityExists(type, name);
        setEntitySummary(type, canonical, summary.trim(), false);
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('MCP server connected on stdio');
}

main().catch((err) => {
  log.error('Fatal error in MCP server:', err);
  process.exit(1);
});
