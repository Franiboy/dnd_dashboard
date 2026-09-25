import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useEntityDialog } from '../hooks/useEntityDialog';
import { useError } from '../hooks/useError';
import { useI18n } from '../hooks/useI18n';
import { useStoryArcs } from '../hooks/useStoryArcs';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DashboardHeader } from '../components/DashboardHeader';
import { Loading } from '../components/Loading';
import { Panel } from '../components/Panel';
import { Modal } from '../components/Modal';
import { TabButton } from '../components/TabButton';
import {
  formatEntityLabel,
  getEntityTypeLabel,
  getEntityTypePluralLabel,
} from '../lib/entityLabels';
import type { TranslationKey } from '../i18n';
import type {
  EntitiesResponse,
  EntityKnowledgeEntry,
  EntityListItem,
  EntityType,
} from '../../shared/types';

type PanelView = 'entities' | 'blacklist';

interface PanelDefinition {
  type: EntityType;
  titleKey: TranslationKey;
  emptyKey: TranslationKey;
}

const PANELS: PanelDefinition[] = [
  {
    type: 'persons',
    titleKey: 'world.panels.persons.title',
    emptyKey: 'world.panels.persons.empty',
  },
  {
    type: 'organizations',
    titleKey: 'world.panels.organizations.title',
    emptyKey: 'world.panels.organizations.empty',
  },
  {
    type: 'locations',
    titleKey: 'world.panels.locations.title',
    emptyKey: 'world.panels.locations.empty',
  },
  { type: 'items', titleKey: 'world.panels.items.title', emptyKey: 'world.panels.items.empty' },
];

interface DragPayload {
  name: string;
  qualifier: string;
  type: EntityType;
}

type PendingAction =
  | { kind: 'blacklist'; name: string; type: EntityType }
  | { kind: 'unblacklist'; name: string; type: EntityType }
  | {
      kind: 'reclassify';
      name: string;
      qualifier: string;
      fromType: EntityType;
      toType: EntityType;
    }
  | {
      kind: 'synonym';
      name: string;
      qualifier: string;
      targetName: string;
      targetQualifier: string;
      type: EntityType;
    };

interface EntityListProps {
  items: EntityListItem[];
  type: EntityType;
  emptyText: string;
  dragPayload: DragPayload | null;
  onDragStart: (name: string, qualifier: string, type: EntityType) => void;
  onDragEnd: () => void;
  onRequestAction: (action: PendingAction) => void;
  onClickItem: (name: string, qualifier: string, type: EntityType) => void;
}

function parseDragPayload(e: React.DragEvent): DragPayload | null {
  try {
    const data = e.dataTransfer.getData('application/json');
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function entityKey(item: EntityListItem): string {
  return `${item.name}\n${item.qualifier}`;
}

function EntityList({
  items,
  type,
  emptyText,
  dragPayload,
  onDragStart,
  onDragEnd,
  onRequestAction,
  onClickItem,
}: EntityListProps) {
  const { t } = useI18n();
  const isReclassifyTarget = dragPayload && dragPayload.type !== type;
  const isOwnDrag = dragPayload && dragPayload.type === type;

  function handleRowDragStart(e: React.DragEvent<HTMLDivElement>, item: EntityListItem) {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({ name: item.name, qualifier: item.qualifier, type })
    );
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(item.name, item.qualifier, type);
  }

  function handleRowDrop(e: React.DragEvent<HTMLDivElement>, target: EntityListItem) {
    e.preventDefault();
    const payload = parseDragPayload(e) ?? dragPayload;
    if (!payload) return;
    if (
      payload.type !== type ||
      (payload.name === target.name && payload.qualifier === target.qualifier)
    ) {
      return;
    }
    e.stopPropagation();
    onRequestAction({
      kind: 'synonym',
      name: payload.name,
      qualifier: payload.qualifier,
      targetName: target.name,
      targetQualifier: target.qualifier,
      type,
    });
  }

  function handleListDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const payload = parseDragPayload(e) ?? dragPayload;
    if (!payload) return;
    if (payload.type === type) return;
    onRequestAction({
      kind: 'reclassify',
      name: payload.name,
      qualifier: payload.qualifier,
      fromType: payload.type,
      toType: type,
    });
  }

  function handleBlacklistDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const payload = parseDragPayload(e) ?? dragPayload;
    if (!payload) return;
    if (payload.type !== type) return;
    onRequestAction({ kind: 'blacklist', name: payload.name, type: payload.type });
  }

  return (
    <>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleListDrop}
        className={`flex-1 min-h-0 overflow-auto -m-4 p-4 space-y-2 transition ${
          isReclassifyTarget ? 'bg-[var(--accent)]/5' : ''
        }`}
      >
        {items.length === 0 ? (
          <p className="text-slate-500 text-sm italic">{emptyText}</p>
        ) : (
          items.map((item) => (
            <div
              key={entityKey(item)}
              draggable
              onDragStart={(e) => handleRowDragStart(e, item)}
              onDragEnd={onDragEnd}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => handleRowDrop(e, item)}
              onClick={() => onClickItem(item.name, item.qualifier, type)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onClickItem(item.name, item.qualifier, type);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={formatEntityLabel(item.name, item.qualifier)}
              title={t('world.list.dragTitle')}
              className={`
                flex items-center gap-2 px-3 py-2 rounded border text-[var(--text-h)] text-sm
                cursor-grab active:cursor-grabbing select-none
                bg-slate-900/50 border-[var(--border)] hover:border-[var(--accent)]
                hover:bg-[var(--accent)]/10 transition
              `}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-slate-500 shrink-0"
              >
                <circle cx="9" cy="12" r="1" />
                <circle cx="9" cy="5" r="1" />
                <circle cx="9" cy="19" r="1" />
                <circle cx="15" cy="12" r="1" />
                <circle cx="15" cy="5" r="1" />
                <circle cx="15" cy="19" r="1" />
              </svg>
              <span className="flex-1 min-w-0 truncate">
                {formatEntityLabel(item.name, item.qualifier)}
              </span>
            </div>
          ))
        )}
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleBlacklistDrop}
        className={`
          flex-none mt-2 -mx-4 -mb-4 px-4 py-3 text-xs text-center border-t border-dashed
          transition
          ${
            isOwnDrag
              ? 'border-[var(--danger)] bg-[var(--danger)]/10 text-[var(--danger)]'
              : 'border-[var(--border)] text-slate-500'
          }
        `}
      >
        {isOwnDrag
          ? t('world.list.dropBlacklist', { type: getEntityTypePluralLabel(type, t) })
          : t('world.list.blacklistHint')}
      </div>
    </>
  );
}

interface BlacklistListProps {
  items: string[];
  type: EntityType;
  emptyText: string;
  onUnblacklist: (name: string, type: EntityType) => void;
}

function BlacklistList({ items, type, emptyText, onUnblacklist }: BlacklistListProps) {
  const { t } = useI18n();
  if (items.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-auto -m-4 p-4">
        <p className="text-slate-500 text-sm italic">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto -m-4 p-4 space-y-2">
      {items.map((item) => (
        <div
          key={item}
          className="flex items-center justify-between gap-3 px-3 py-2 rounded bg-slate-900/50 border border-[var(--border)] text-[var(--text-h)] text-sm"
        >
          <span className="flex-1 min-w-0 truncate">{item}</span>
          <button
            type="button"
            title={t('world.list.removeBlacklist')}
            aria-label={t('world.list.removeBlacklist')}
            onClick={() => onUnblacklist(item, type)}
            className="text-slate-500 hover:text-[var(--accent)] transition"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

function BanIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

interface DistributeKnowledgeDialogProps {
  onClose: () => void;
  onDistributed: () => void;
  /** Arc the global filter is set to; knowledge gets filed there. */
  arcId?: number;
}

function DistributeKnowledgeDialog({
  onClose,
  onDistributed,
  arcId,
}: DistributeKnowledgeDialogProps) {
  const { request } = useApi();
  const { showSuccess, showError } = useError();
  const { t, formatNumber } = useI18n();
  const [text, setText] = useState('');
  const [working, setWorking] = useState(false);

  async function handleDistribute() {
    if (!text.trim()) return;
    setWorking(true);
    const { data, error } = await request<{
      created: EntityKnowledgeEntry[];
      deleted: { id: number; reason: string; entry: EntityKnowledgeEntry }[];
      ended?: { id: number; reason: string; entry: EntityKnowledgeEntry }[];
    }>('/api/entities/knowledge/distribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim(), ...(arcId ? { arcId } : {}) }),
    });
    setWorking(false);
    if (!error && data) {
      const parts: string[] = [];
      if (data.created.length) {
        parts.push(
          t('world.distribute.changes.created', {
            count: data.created.length,
            formattedCount: formatNumber(data.created.length),
          })
        );
      }
      if (data.ended && data.ended.length) {
        parts.push(
          t('world.distribute.changes.ended', {
            count: data.ended.length,
            formattedCount: formatNumber(data.ended.length),
          })
        );
      }
      if (data.deleted.length) {
        parts.push(
          t('world.distribute.changes.deleted', {
            count: data.deleted.length,
            formattedCount: formatNumber(data.deleted.length),
          })
        );
      }
      showSuccess(
        parts.length
          ? t('world.distribute.success', { parts: parts.join(', ') })
          : t('world.distribute.noChanges')
      );
      onDistributed();
      onClose();
    } else if (error) {
      showError(error);
    }
  }

  return (
    <Modal
      isOpen
      title={t('world.distribute.title')}
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition disabled:opacity-50"
          >
            {t('world.distribute.cancel')}
          </button>
          <button
            type="button"
            onClick={handleDistribute}
            disabled={working || !text.trim()}
            className="px-4 py-2 rounded font-semibold bg-[var(--accent)] text-[var(--accent-contrast)] hover:brightness-110 transition disabled:opacity-50"
          >
            {working ? t('world.distribute.processing') : t('world.distribute.action')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-400">{t('world.distribute.description')}</p>
        <textarea
          value={text}
          aria-label={t('world.distribute.title')}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={t('world.distribute.placeholder')}
          className="w-full px-3 py-2 rounded bg-slate-900/50 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none resize-y"
        />
      </div>
    </Modal>
  );
}

export function World() {
  const { request } = useApi();
  const { openEntity } = useEntityDialog();
  const { showSuccess } = useError();
  const { t } = useI18n();
  const { selectedArcId, arcs: storyArcs } = useStoryArcs();
  // `null` = all, number = that arc, 'none' = entities without any arc. The
  // 'none' sentinel is forwarded to the server (arcId=none), not dropped.
  const filterArcParam = selectedArcId === null ? undefined : selectedArcId;
  const filterArcId = typeof selectedArcId === 'number' ? selectedArcId : undefined;
  const filterArcLabel =
    selectedArcId === 'none'
      ? t('world.filter.noArc')
      : typeof selectedArcId === 'number'
        ? (storyArcs.find((arc) => arc.id === selectedArcId)?.name ?? null)
        : null;
  const [entities, setEntities] = useState<EntitiesResponse | null>(null);
  const [blacklists, setBlacklists] = useState<{
    persons: string[];
    organizations: string[];
    locations: string[];
    items: string[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionWorking, setActionWorking] = useState(false);
  const [panelViews, setPanelViews] = useState<Record<EntityType, PanelView>>({
    persons: 'entities',
    organizations: 'entities',
    locations: 'entities',
    items: 'entities',
  });
  // Active entity list on small screens, where the panels stack behind tabs.
  const [activePanel, setActivePanel] = useState<EntityType>('persons');
  const [distributeOpen, setDistributeOpen] = useState(false);

  const canClickRef = useRef(true);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    (arcParam?: number | 'none') => {
      const query = arcParam !== undefined ? `?arcId=${arcParam}` : '';
      return request<EntitiesResponse>(`/api/entities${query}`).then(({ data }) => {
        if (data) {
          setEntities(data);
        }
        setLoading(false);
      });
    },
    [request]
  );

  const loadBlacklists = useCallback(() => {
    return request<{
      persons: string[];
      organizations: string[];
      locations: string[];
      items: string[];
    }>('/api/entities/blacklist').then(({ data }) => {
      if (data) {
        setBlacklists(data);
      }
    });
  }, [request]);

  useEffect(() => {
    load(filterArcParam);
    loadBlacklists();
  }, [load, loadBlacklists, filterArcParam]);

  async function executeAction(action: PendingAction) {
    setActionWorking(true);
    let endpoint = '';
    let body: Record<string, string> = {};

    switch (action.kind) {
      case 'blacklist':
        endpoint = '/api/entities/blacklist';
        body = { name: action.name, type: action.type };
        break;
      case 'unblacklist':
        endpoint = '/api/entities/unblacklist';
        body = { name: action.name, type: action.type };
        break;
      case 'reclassify':
        endpoint = '/api/entities/reclassify';
        body = {
          name: action.name,
          qualifier: action.qualifier,
          fromType: action.fromType,
          toType: action.toType,
        };
        break;
      case 'synonym':
        endpoint = '/api/entities/alias';
        body = {
          type: action.type,
          alias: action.name,
          canonical: action.targetName,
          canonicalQualifier: action.targetQualifier,
        };
        break;
    }

    const { error } = await request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setActionWorking(false);
    setPendingAction(null);

    if (!error) {
      showSuccess(t('world.actions.success'));
      load(filterArcParam);
      loadBlacklists();
    }
  }

  function handleDragStart(name: string, qualifier: string, type: EntityType) {
    if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
    canClickRef.current = false;
    setDragPayload({ name, qualifier, type });
  }

  function handleDragEnd() {
    if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
    clickTimeoutRef.current = setTimeout(() => {
      canClickRef.current = true;
    }, 200);
    setDragPayload(null);
  }

  function handleEntityClick(name: string, qualifier: string, type: EntityType) {
    if (!canClickRef.current) return;
    openEntity(
      name,
      type,
      () => {
        load(filterArcParam);
        loadBlacklists();
      },
      qualifier
    );
  }

  function handleRequestAction(action: PendingAction) {
    setPendingAction(action);
  }

  function handleUnblacklist(name: string, type: EntityType) {
    setPendingAction({ kind: 'unblacklist', name, type });
  }

  function cancelAction() {
    setPendingAction(null);
  }

  function toggleView(type: EntityType) {
    setPanelViews((prev) => ({
      ...prev,
      [type]: prev[type] === 'entities' ? 'blacklist' : 'entities',
    }));
  }

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <Loading size="lg" />
      </div>
    );
  }

  const data = entities ?? { persons: [], organizations: [], locations: [], items: [] };
  const blacklistData = blacklists ?? { persons: [], organizations: [], locations: [], items: [] };

  function actionDialogContent(action: PendingAction) {
    switch (action.kind) {
      case 'blacklist':
        return t('world.actions.blacklistQuestion', {
          name: action.name,
          type: getEntityTypeLabel(action.type, t),
          plural: getEntityTypePluralLabel(action.type, t),
        });
      case 'unblacklist':
        return t('world.actions.unblacklistQuestion', {
          name: action.name,
          type: getEntityTypeLabel(action.type, t),
          plural: getEntityTypePluralLabel(action.type, t),
        });
      case 'reclassify':
        return t('world.actions.reclassifyQuestion', {
          name: formatEntityLabel(action.name, action.qualifier),
          from: getEntityTypePluralLabel(action.fromType, t),
          to: getEntityTypePluralLabel(action.toType, t),
        });
      case 'synonym':
        return t('world.actions.synonymQuestion', {
          name: formatEntityLabel(action.name, action.qualifier),
          target: formatEntityLabel(action.targetName, action.targetQualifier),
        });
    }
  }

  function actionDialogTitle(action: PendingAction) {
    switch (action.kind) {
      case 'blacklist':
        return t('world.actions.blacklistTitle', {
          type: getEntityTypeLabel(action.type, t),
        });
      case 'unblacklist':
        return t('world.actions.unblacklistTitle');
      case 'reclassify':
        return t('world.actions.reclassifyTitle');
      case 'synonym':
        return t('world.actions.synonymTitle');
    }
  }

  function renderPanel(type: EntityType, title: string, emptyText: string) {
    const isBlacklist = panelViews[type] === 'blacklist';

    return (
      <div key={type} className="h-full min-h-0">
        <Panel
          title={isBlacklist ? t('world.list.blacklistTitle', { type: title }) : title}
          actions={
            <button
              type="button"
              onClick={() => toggleView(type)}
              title={isBlacklist ? t('world.list.normalView') : t('world.list.showBlacklist')}
              aria-label={isBlacklist ? t('world.list.normalView') : t('world.list.showBlacklist')}
              className="text-slate-500 hover:text-[var(--accent)] transition"
            >
              {isBlacklist ? <ListIcon /> : <BanIcon />}
            </button>
          }
        >
          {isBlacklist ? (
            <BlacklistList
              items={blacklistData[type]}
              type={type}
              emptyText={t('world.list.blacklistEmpty', {
                type: getEntityTypePluralLabel(type, t),
              })}
              onUnblacklist={handleUnblacklist}
            />
          ) : (
            <EntityList
              type={type}
              items={data[type]}
              emptyText={emptyText}
              dragPayload={dragPayload}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onRequestAction={handleRequestAction}
              onClickItem={handleEntityClick}
            />
          )}
        </Panel>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 sm:p-6">
      <DashboardHeader>
        {filterArcLabel && (
          <span className="mr-auto text-sm text-slate-400">
            {t('world.filter.filteredByArc')}{' '}
            <strong className="text-[var(--text-h)]">{filterArcLabel}</strong>
          </span>
        )}
        <button
          type="button"
          onClick={() => setDistributeOpen(true)}
          className="px-4 py-2 rounded bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold hover:brightness-110 transition"
        >
          {t('world.distribute.title')}
        </button>
      </DashboardHeader>

      {/* Desktop layout: all four lists side by side. */}
      <div className="hidden md:grid md:grid-cols-2 xl:grid-cols-4 gap-4 flex-1 min-h-0">
        {PANELS.map((panel) => renderPanel(panel.type, t(panel.titleKey), t(panel.emptyKey)))}
      </div>

      {/* Mobile layout: full-height panel switched via tabs. */}
      <div className="md:hidden flex flex-col flex-1 min-h-0 gap-3">
        <div className="flex items-center gap-2 shrink-0">
          {PANELS.map((panel) => (
            <TabButton
              key={panel.type}
              active={activePanel === panel.type}
              onClick={() => setActivePanel(panel.type)}
              className="text-xs px-1"
            >
              {t(panel.titleKey)}
            </TabButton>
          ))}
        </div>

        {PANELS.map((panel) =>
          activePanel === panel.type ? (
            <div key={panel.type} className="flex-1 min-h-0">
              {renderPanel(panel.type, t(panel.titleKey), t(panel.emptyKey))}
            </div>
          ) : null
        )}
      </div>

      {pendingAction && (
        <ConfirmDialog
          title={actionDialogTitle(pendingAction)}
          variant="danger"
          confirmLabel={t('world.actions.confirm')}
          loading={actionWorking}
          onConfirm={() => executeAction(pendingAction)}
          onCancel={cancelAction}
        >
          <p>{actionDialogContent(pendingAction)}</p>
        </ConfirmDialog>
      )}

      {distributeOpen && (
        <DistributeKnowledgeDialog
          onClose={() => setDistributeOpen(false)}
          arcId={filterArcId}
          onDistributed={() => {
            load(filterArcParam);
            loadBlacklists();
          }}
        />
      )}
    </div>
  );
}
