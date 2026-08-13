import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react';
import { EntityDialogContext } from './EntityDialogContext';
import { Loading } from '../components/Loading';
import { Modal } from '../components/Modal';
import type { EntityType } from '../../shared/types';

const EntityEditDialog = lazy(() =>
  import('../components/EntityEditDialog').then((m) => ({ default: m.EntityEditDialog }))
);

interface EntityDialogProviderProps {
  children: ReactNode;
}

interface EntityDialogState {
  name: string;
  type: EntityType;
  onSaved?: () => void;
}

export function EntityDialogProvider({ children }: EntityDialogProviderProps) {
  const [entity, setEntity] = useState<EntityDialogState | null>(null);

  const openEntity = useCallback((name: string, type: EntityType, onSaved?: () => void) => {
    setEntity((prev) => {
      if (prev && prev.name === name && prev.type === type) {
        if (onSaved === undefined || prev.onSaved === onSaved) return prev;
        return { ...prev, onSaved };
      }
      return { name, type, onSaved: onSaved ?? prev?.onSaved };
    });
  }, []);

  const closeEntity = useCallback(() => {
    setEntity(null);
  }, []);

  const value = useMemo(() => ({ openEntity, closeEntity }), [openEntity, closeEntity]);

  return (
    <EntityDialogContext.Provider value={value}>
      {children}
      {entity && (
        <Suspense
          fallback={
            <Modal isOpen title="Entität laden" className="max-w-xl" onClose={closeEntity}>
              <div className="py-8 flex justify-center">
                <Loading size="md" />
              </div>
            </Modal>
          }
        >
          <EntityEditDialog
            key={`${entity.type}-${entity.name}`}
            type={entity.type}
            name={entity.name}
            onClose={closeEntity}
            onSaved={entity.onSaved}
          />
        </Suspense>
      )}
    </EntityDialogContext.Provider>
  );
}
