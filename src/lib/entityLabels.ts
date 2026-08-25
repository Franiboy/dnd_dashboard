import type { EntityType } from '../../shared/types';

export const typeLabels: Record<EntityType, string> = {
  persons: 'Person',
  organizations: 'Organisation',
  locations: 'Ort',
};

export const typeAccusative: Record<EntityType, string> = {
  persons: 'Personen',
  organizations: 'Organisationen',
  locations: 'Orte',
};

/** Display form of an entity: "Name" or "Name (Qualifier)". */
export function formatEntityLabel(name: string, qualifier?: string | null): string {
  return qualifier ? `${name} (${qualifier})` : name;
}

/**
 * Splits a possibly qualified label ("Name (Qualifier)") back into its parts.
 * Tolerant: callers should first try the untouched string as a plain name
 * (legacy behaviour) before using the parsed qualifier.
 */
export function splitEntityLabel(label: string): { name: string; qualifier: string } {
  const trimmed = label.trim();
  const match = /^(.*)\s\(([^()]+)\)$/.exec(trimmed);
  if (match && match[1].trim()) {
    return { name: match[1].trim(), qualifier: match[2].trim() };
  }
  return { name: trimmed, qualifier: '' };
}
