import { createContext } from 'react';
import type { EntityType } from '../../shared/types';

export interface EntityDialogContextValue {
  openEntity: (name: string, type: EntityType, onSaved?: () => void, qualifier?: string) => void;
  closeEntity: () => void;
}

export const EntityDialogContext = createContext<EntityDialogContextValue | null>(null);
