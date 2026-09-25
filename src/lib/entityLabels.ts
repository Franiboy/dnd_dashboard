import type { EntityType } from '../../shared/types';
import { translate, type TFunction, type TranslationKey } from '../i18n/messages';

export const entityTypeLabelKeys: Record<EntityType, TranslationKey> = {
  persons: 'shared.entityTypes.persons',
  organizations: 'shared.entityTypes.organizations',
  locations: 'shared.entityTypes.locations',
  items: 'shared.entityTypes.items',
};

export const entityTypePluralLabelKeys: Record<EntityType, TranslationKey> = {
  persons: 'world.entityTypePlural.persons',
  organizations: 'world.entityTypePlural.organizations',
  locations: 'world.entityTypePlural.locations',
  items: 'world.entityTypePlural.items',
};

/** Localized singular entity type label. */
export function getEntityTypeLabel(type: EntityType, t: TFunction): string {
  return t(entityTypeLabelKeys[type]);
}

/** Localized plural entity type label for list and confirmation copy. */
export function getEntityTypePluralLabel(type: EntityType, t: TFunction): string {
  return t(entityTypePluralLabelKeys[type]);
}

/**
 * German fallback labels for non-React callers. UI components should use the
 * translator-aware helpers above instead.
 */
export const typeLabels: Record<EntityType, string> = {
  persons: translate('de', entityTypeLabelKeys.persons),
  organizations: translate('de', entityTypeLabelKeys.organizations),
  locations: translate('de', entityTypeLabelKeys.locations),
  items: translate('de', entityTypeLabelKeys.items),
};

export const typeAccusative: Record<EntityType, string> = {
  persons: translate('de', entityTypePluralLabelKeys.persons),
  organizations: translate('de', entityTypePluralLabelKeys.organizations),
  locations: translate('de', entityTypePluralLabelKeys.locations),
  items: translate('de', entityTypePluralLabelKeys.items),
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
