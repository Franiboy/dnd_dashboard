import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react';
import { EntityDialogContext, type EntityDialogTab } from './EntityDialogContext';
import { Loading } from '../components/Loading';
import { Modal } from '../components/Modal';
import type { EntityType } from '../../shared/types';
import { useI18n } from '../hooks/useI18n';

const EntityEditDialog = lazy(() =>
  import('../components/EntityEditDialog').then((m) => ({ default: m.EntityEditDialog }))
);

interface EntityDialogProviderProps {
  children: ReactNode;
}

interface EntityDialogState {
  name: string;
  type: EntityType;
  qualifier: string;
  onSaved?: () => void;
  initialTab?: EntityDialogTab;
}

export function EntityDialogProvider({ children }: EntityDialogProviderProps) {
  const [entity, setEntity] = useState<EntityDialogState | null>(null);
  const { t } = useI18n();

  const openEntity = useCallback(
    (
      name: string,
      type: EntityType,
      onSaved?: () => void,
      qualifier = '',
      initialTab?: EntityDialogTab
    ) => {
      setEntity((prev) => {
        if (
          prev &&
          prev.name === name &&
          prev.type === type &&
          prev.qualifier === (qualifier ?? '')
        ) {
          if (onSaved === undefined && initialTab === undefined) return prev;
          return { ...prev, onSaved: onSaved ?? prev.onSaved, initialTab };
        }
        return {
          name,
          type,
          qualifier: qualifier ?? '',
          onSaved: onSaved ?? prev?.onSaved,
          initialTab,
        };
      });
    },
    []
  );

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
            <Modal
              isOpen
              title={t('world.entityDialog.loading')}
              className="max-w-xl"
              onClose={closeEntity}
            >
              <div className="py-8 flex justify-center">
                <Loading size="md" />
              </div>
            </Modal>
          }
        >
          <EntityEditDialog
            key={`${entity.type}-${entity.name}-${entity.qualifier}-${entity.initialTab ?? 'default'}`}
            type={entity.type}
            name={entity.name}
            qualifier={entity.qualifier}
            initialTab={entity.initialTab}
            onClose={closeEntity}
            onSaved={entity.onSaved}
          />
        </Suspense>
      )}
    </EntityDialogContext.Provider>
  );
}
