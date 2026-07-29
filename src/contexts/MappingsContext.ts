import { createContext } from 'react';
import type { EntityMapping } from '../../shared/types';

export interface MappingsContextValue {
  mappings: EntityMapping[];
  refresh: () => Promise<EntityMapping[]>;
}

export const MappingsContext = createContext<MappingsContextValue | null>(null);
