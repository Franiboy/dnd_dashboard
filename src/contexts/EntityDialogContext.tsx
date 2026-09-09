import { createContext } from 'react';
import type { EntityType } from '../../shared/types';

/** Tab shown when the entity dialog opens (defaults to 'summary'). */
export type EntityDialogTab = 'summary' | 'aliases' | 'knowledge' | 'arcs';

export interface EntityDialogContextValue {
  openEntity: (
    name: string,
    type: EntityType,
    onSaved?: () => void,
    qualifier?: string,
    initialTab?: EntityDialogTab
  ) => void;
  closeEntity: () => void;
}

export const EntityDialogContext = createContext<EntityDialogContextValue | null>(null);
