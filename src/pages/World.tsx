import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useEntityDialog } from '../hooks/useEntityDialog';
import { useError } from '../hooks/useError';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DashboardHeader } from '../components/DashboardHeader';
import { Loading } from '../components/Loading';
import { Panel } from '../components/Panel';
import { Modal } from '../components/Modal';
import { typeLabels, typeAccusative, formatEntityLabel } from '../lib/entityLabels';
import type {
  EntitiesResponse,
  EntityKnowledgeEntry,
  EntityListItem,
  EntityType,
} from '../../shared/types';

type PanelView = 'entities' | 'blacklist';

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
              title="Klicken zum Öffnen. Ziehen: auf andere Liste = umwandeln, auf anderes Element = Synonym, unten = Blacklist"
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
          ? `Hier fallen lassen, um als ${typeAccusative[type]} zu blacklisten`
          : 'Zum Blacklisten hierher ziehen'}
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
            title="Aus Blacklist entfernen"
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
}

function DistributeKnowledgeDialog({ onClose, onDistributed }: DistributeKnowledgeDialogProps) {
  const { request } = useApi();
  const { showSuccess, showError } = useError();
  const [text, setText] = useState('');
  const [working, setWorking] = useState(false);

  async function handleDistribute() {
    if (!text.trim()) return;
    setWorking(true);
    const { data, error } = await request<{
      created: EntityKnowledgeEntry[];
      deleted: { id: number; reason: string; entry: EntityKnowledgeEntry }[];
    }>('/api/entities/knowledge/distribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim() }),
    });
    setWorking(false);
    if (!error && data) {
      const parts: string[] = [];
      if (data.created.length) parts.push(`${data.created.length} neu`);
      if (data.deleted.length) parts.push(`${data.deleted.length} als gelöscht markiert`);
      showSuccess(
        parts.length ? `Wissen eingeordnet: ${parts.join(', ')}.` : 'Keine Änderungen erkannt.'
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
      title="Wissen einordnen"
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition disabled:opacity-50"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleDistribute}
            disabled={working || !text.trim()}
            className="px-4 py-2 rounded font-semibold bg-[var(--accent)] text-slate-900 hover:brightness-110 transition disabled:opacity-50"
          >
            {working ? 'Wird eingeordnet...' : 'Einordnen'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-400">
          Gib einen Freitext ein. Die KI ordnet die Fakten passenden Entitäten zu, legt
          Wissenseinträge an und markiert widersprüchliche Einträge als gelöscht.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="z. B. Vimak und Gideon gehören der Wagenwacht an."
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
  const [entities, setEntities] = useState<EntitiesResponse | null>(null);
  const [blacklists, setBlacklists] = useState<{
    persons: string[];
    organizations: string[];
    locations: string[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionWorking, setActionWorking] = useState(false);
  const [panelViews, setPanelViews] = useState<Record<EntityType, PanelView>>({
    persons: 'entities',
    organizations: 'entities',
    locations: 'entities',
  });
  const [distributeOpen, setDistributeOpen] = useState(false);

  const canClickRef = useRef(true);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data } = await request<EntitiesResponse>('/api/entities');
    if (data) {
      setEntities(data);
    }
    setLoading(false);
  }, [request]);

  const loadBlacklists = useCallback(async () => {
    const { data } = await request<{
      persons: string[];
      organizations: string[];
      locations: string[];
    }>('/api/entities/blacklist');
    if (data) {
      setBlacklists(data);
    }
  }, [request]);

  useEffect(() => {
    load();
    loadBlacklists();
  }, [load, loadBlacklists]);

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
      showSuccess('Aktion ausgeführt.');
      load();
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
        load();
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

  const data = entities ?? { persons: [], organizations: [], locations: [] };
  const blacklistData = blacklists ?? { persons: [], organizations: [], locations: [] };

  function actionDialogContent(action: PendingAction) {
    switch (action.kind) {
      case 'blacklist':
        return (
          <>
            Soll <strong>{action.name}</strong> als {typeLabels[action.type]} in die Blacklist
            aufgenommen werden? Der Name wird aus der {typeAccusative[action.type]}-Liste entfernt
            und zukünftig nicht mehr als {typeLabels[action.type]} erkannt.
          </>
        );
      case 'unblacklist':
        return (
          <>
            Soll <strong>{action.name}</strong> aus der Blacklist für {typeAccusative[action.type]}{' '}
            entfernt werden? Der Name kann danach wieder als {typeLabels[action.type]} erkannt
            werden.
          </>
        );
      case 'reclassify':
        return (
          <>
            Soll <strong>{formatEntityLabel(action.name, action.qualifier)}</strong> von{' '}
            {typeAccusative[action.fromType]} zu {typeAccusative[action.toType]} umgewandelt werden?
          </>
        );
      case 'synonym':
        return (
          <>
            Soll <strong>{formatEntityLabel(action.name, action.qualifier)}</strong> als Synonym
            (Alias) für{' '}
            <strong>{formatEntityLabel(action.targetName, action.targetQualifier)}</strong>{' '}
            gespeichert werden? Beide Entitäten werden zusammengeführt; zukünftige Erwähnungen von{' '}
            {action.name} werden als {action.targetName} erkannt.
          </>
        );
    }
  }

  function actionDialogTitle(action: PendingAction) {
    switch (action.kind) {
      case 'blacklist':
        return `${typeLabels[action.type]} blacklisten?`;
      case 'unblacklist':
        return 'Aus Blacklist entfernen?';
      case 'reclassify':
        return 'Typ ändern?';
      case 'synonym':
        return 'Synonym erstellen?';
    }
  }

  function renderPanel(type: EntityType, title: string, emptyText: string) {
    const isBlacklist = panelViews[type] === 'blacklist';

    return (
      <div key={type} className="h-full min-h-0">
        <Panel
          title={isBlacklist ? `Blacklist – ${title}` : title}
          actions={
            <button
              type="button"
              onClick={() => toggleView(type)}
              title={isBlacklist ? 'Zur normalen Ansicht' : 'Blacklist anzeigen'}
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
              emptyText={`Noch keine ${typeAccusative[type]} in der Blacklist.`}
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
    <div className="h-full flex flex-col p-6">
      <DashboardHeader>
        <button
          type="button"
          onClick={() => setDistributeOpen(true)}
          className="px-4 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:brightness-110 transition"
        >
          Wissen einordnen
        </button>
      </DashboardHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 lg:grid-rows-1 gap-4 flex-1 min-h-0">
        {renderPanel('persons', 'Personen', 'Noch keine Personen vorhanden.')}
        {renderPanel('organizations', 'Organisationen', 'Noch keine Organisationen vorhanden.')}
        {renderPanel('locations', 'Orte', 'Noch keine Orte vorhanden.')}
      </div>

      {pendingAction && (
        <ConfirmDialog
          title={actionDialogTitle(pendingAction)}
          variant="danger"
          confirmLabel="Bestätigen"
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
          onDistributed={() => {
            load();
            loadBlacklists();
          }}
        />
      )}
    </div>
  );
}
