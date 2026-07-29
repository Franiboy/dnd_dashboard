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
