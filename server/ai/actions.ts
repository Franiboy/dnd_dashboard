import type { EntityType } from '../../shared/types.js';
import {
  addEntityAlias,
  blacklistEntity,
  ensureEntityExists,
  reclassifyEntity,
  unblacklistEntity,
  updateEntity,
} from '../repositories/diary.js';
import {
  createEntityKnowledge,
  getEntityKnowledgeEntry,
  markEntityKnowledgeDeleted,
  updateEntityKnowledge,
} from '../repositories/entityKnowledge.js';
import { setEntitySummary } from '../repositories/entitySummaries.js';
import { createLogger } from '../logger.js';

const log = createLogger('ai-actions');

export type AiAction =
  | { action: 'createEntity'; type: EntityType; name: string; aliases?: string[] }
  | {
      action: 'renameEntity';
      type: EntityType;
      oldName: string;
      newName: string;
      aliases?: string[];
    }
  | { action: 'addAlias'; type: EntityType; alias: string; canonical: string }
  | { action: 'reclassifyEntity'; name: string; fromType: EntityType; toType: EntityType }
  | { action: 'blacklistEntity'; type: EntityType; name: string }
  | { action: 'unblacklistEntity'; type: EntityType; name: string }
  | {
      action: 'createKnowledge';
      type: EntityType;
      name: string;
      title?: string | null;
      content: string;
    }
  | { action: 'updateKnowledge'; id: number; title?: string | null; content?: string }
  | { action: 'deleteKnowledge'; id: number; reason?: string | null }
  | { action: 'setSummary'; type: EntityType; name: string; summary: string | null };

export interface AiActionResult {
  action: AiAction;
  success: boolean;
  message?: string;
  data?: unknown;
}

function isValidEntityType(value: unknown): value is EntityType {
  return value === 'persons' || value === 'organizations' || value === 'locations';
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function validateAction(raw: unknown): AiAction | null {
  if (!raw || typeof raw !== 'object' || !('action' in raw)) return null;
  const actionRaw = (raw as { action: unknown }).action;
  if (typeof actionRaw !== 'string') return null;

  switch (actionRaw) {
    case 'createEntity': {
      const { type, name, aliases } = raw as Record<string, unknown>;
      if (!isValidEntityType(type)) return null;
      const normalizedName = normalizeName(name);
      if (!normalizedName) return null;
      return {
        action: 'createEntity',
        type,
        name: normalizedName,
        aliases: normalizeStringArray(aliases),
      };
    }
    case 'renameEntity': {
      const { type, oldName, newName, aliases } = raw as Record<string, unknown>;
      if (!isValidEntityType(type)) return null;
      const normalizedOld = normalizeName(oldName);
      const normalizedNew = normalizeName(newName);
      if (!normalizedOld || !normalizedNew) return null;
      return {
        action: 'renameEntity',
        type,
        oldName: normalizedOld,
        newName: normalizedNew,
        aliases: normalizeStringArray(aliases),
      };
    }
    case 'addAlias': {
      const { type, alias, canonical } = raw as Record<string, unknown>;
      if (!isValidEntityType(type)) return null;
      const normalizedAlias = normalizeName(alias);
      const normalizedCanonical = normalizeName(canonical);
      if (!normalizedAlias || !normalizedCanonical) return null;
      return { action: 'addAlias', type, alias: normalizedAlias, canonical: normalizedCanonical };
    }
    case 'reclassifyEntity': {
      const { name, fromType, toType } = raw as Record<string, unknown>;
      if (!isValidEntityType(fromType) || !isValidEntityType(toType)) return null;
      const normalizedName = normalizeName(name);
      if (!normalizedName) return null;
      return { action: 'reclassifyEntity', name: normalizedName, fromType, toType };
    }
    case 'blacklistEntity': {
      const { type, name } = raw as Record<string, unknown>;
      if (!isValidEntityType(type)) return null;
      const normalizedName = normalizeName(name);
      if (!normalizedName) return null;
      return { action: 'blacklistEntity', type, name: normalizedName };
    }
    case 'unblacklistEntity': {
      const { type, name } = raw as Record<string, unknown>;
      if (!isValidEntityType(type)) return null;
      const normalizedName = normalizeName(name);
      if (!normalizedName) return null;
      return { action: 'unblacklistEntity', type, name: normalizedName };
    }
    case 'createKnowledge': {
      const { type, name, title, content } = raw as Record<string, unknown>;
      if (!isValidEntityType(type)) return null;
      const normalizedName = normalizeName(name);
      const normalizedContent = normalizeString(content);
      if (!normalizedName || !normalizedContent) return null;
      return {
        action: 'createKnowledge',
        type,
        name: normalizedName,
        title: normalizeOptionalString(title),
        content: normalizedContent,
      };
    }
    case 'updateKnowledge': {
      const { id, title, content } = raw as Record<string, unknown>;
      const normalizedId = typeof id === 'number' ? id : Number(String(id));
      if (!Number.isInteger(normalizedId) || normalizedId <= 0) return null;
      if (title === undefined && content === undefined) return null;
      if (title !== undefined && title !== null && normalizeString(title) === null) return null;
      if (content !== undefined && normalizeString(content) === null) return null;
      return {
        action: 'updateKnowledge',
        id: normalizedId,
        title: normalizeOptionalString(title),
        content: normalizeOptionalString(content) ?? undefined,
      };
    }
    case 'deleteKnowledge': {
      const { id, reason } = raw as Record<string, unknown>;
      const normalizedId = typeof id === 'number' ? id : Number(String(id));
      if (!Number.isInteger(normalizedId) || normalizedId <= 0) return null;
      return {
        action: 'deleteKnowledge',
        id: normalizedId,
        reason: normalizeOptionalString(reason),
      };
    }
    case 'setSummary': {
      const { type, name, summary } = raw as Record<string, unknown>;
      if (!isValidEntityType(type)) return null;
      const normalizedName = normalizeName(name);
      if (!normalizedName) return null;
      return {
        action: 'setSummary',
        type,
        name: normalizedName,
        summary: normalizeOptionalString(summary),
      };
    }
    default:
      return null;
  }
}

export function parseAiActions(raw: unknown): AiAction[] {
  if (!Array.isArray(raw)) return [];
  const actions: AiAction[] = [];
  for (const item of raw) {
    const action = validateAction(item);
    if (action) actions.push(action);
    else log.warn('Ignored invalid AI action:', item);
  }
  return actions;
}

export function executeAction(action: AiAction): AiActionResult {
  try {
    switch (action.action) {
      case 'createEntity': {
        const ref = ensureEntityExists(action.type, action.name);
        if (action.aliases && action.aliases.length > 0) {
          for (const alias of action.aliases) {
            addEntityAlias(action.type, alias, ref.name, ref.qualifier);
          }
        }
        return { action, success: true, data: { canonical: ref.name } };
      }
      case 'renameEntity': {
        if (action.oldName.toLowerCase() === action.newName.toLowerCase()) {
          return { action, success: true };
        }
        updateEntity(action.type, action.oldName, action.newName, action.aliases ?? []);
        return { action, success: true };
      }
      case 'addAlias': {
        addEntityAlias(action.type, action.alias, action.canonical);
        return { action, success: true };
      }
      case 'reclassifyEntity': {
        reclassifyEntity(action.name, action.fromType, action.toType);
        return { action, success: true };
      }
      case 'blacklistEntity': {
        blacklistEntity(action.name, action.type);
        return { action, success: true };
      }
      case 'unblacklistEntity': {
        unblacklistEntity(action.name, action.type);
        return { action, success: true };
      }
      case 'createKnowledge': {
        const ref = ensureEntityExists(action.type, action.name);
        const entry = createEntityKnowledge(
          action.type,
          ref.name,
          action.title ?? null,
          action.content,
          'ai_extracted',
          ref.qualifier
        );
        return { action, success: true, data: entry };
      }
      case 'updateKnowledge': {
        const existing = getEntityKnowledgeEntry(action.id);
        if (!existing) return { action, success: false, message: 'Wissenseintrag nicht gefunden' };
        const updates: { title?: string | null; content?: string } = {};
        if (action.title !== undefined) updates.title = action.title;
        if (action.content !== undefined) updates.content = action.content;
        const entry = updateEntityKnowledge(action.id, updates);
        return { action, success: true, data: entry };
      }
      case 'deleteKnowledge': {
        const existing = getEntityKnowledgeEntry(action.id);
        if (!existing) return { action, success: false, message: 'Wissenseintrag nicht gefunden' };
        const entry = markEntityKnowledgeDeleted(action.id, action.reason);
        return { action, success: true, data: entry };
      }
      case 'setSummary': {
        const ref = ensureEntityExists(action.type, action.name);
        setEntitySummary(action.type, ref.name, action.summary, false, undefined, ref.qualifier);
        return { action, success: true };
      }
      default:
        return { action, success: false, message: 'Unbekannte Aktion' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ausführung fehlgeschlagen';
    log.warn(`AI action failed: ${action.action}`, err);
    return { action, success: false, message };
  }
}

export function executeAiActions(actions: AiAction[]): AiActionResult[] {
  return actions.map(executeAction);
}
