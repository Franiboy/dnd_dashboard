import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useError } from '../hooks/useError';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DashboardHeader } from '../components/DashboardHeader';
import { DashboardLayout } from '../components/DashboardLayout';
import { GridPanel } from '../components/GridPanel';
import { Loading } from '../components/Loading';
import { Modal } from '../components/Modal';
import type { EntitiesResponse, EntityDetail, EntityType, EntityUpdatePayload } from '../../shared/types';

type PanelView = 'entities' | 'blacklist';

interface DragPayload {
  name: string;
  type: EntityType;
}

type PendingAction =
  | { kind: 'blacklist'; name: string; type: EntityType }
  | { kind: 'unblacklist'; name: string; type: EntityType }
  | { kind: 'reclassify'; name: string; fromType: EntityType; toType: EntityType }
  | { kind: 'synonym'; name: string; targetName: string; type: EntityType };

const typeLabels: Record<EntityType, string> = {
  persons: 'Person',
  organizations: 'Organisation',
  locations: 'Ort',
};

const typeAccusative: Record<EntityType, string> = {
  persons: 'Personen',
  organizations: 'Organisationen',
  locations: 'Orte',
};

interface EntityListProps {
  items: string[];
  type: EntityType;
  emptyText: string;
  dragPayload: DragPayload | null;
  onDragStart: (name: string, type: EntityType) => void;
  onDragEnd: () => void;
  onRequestAction: (action: PendingAction) => void;
  onClickItem: (name: string, type: EntityType) => void;
}

function parseDragPayload(e: React.DragEvent): DragPayload | null {
  try {
    const data = e.dataTransfer.getData('application/json');
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
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

  function handleRowDragStart(e: React.DragEvent<HTMLDivElement>, name: string) {
    e.dataTransfer.setData('application/json', JSON.stringify({ name, type }));
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(name, type);
  }

  function handleRowDrop(e: React.DragEvent<HTMLDivElement>, targetName: string) {
    e.preventDefault();
    const payload = parseDragPayload(e) ?? dragPayload;
    if (!payload) return;
    if (payload.type !== type || payload.name === targetName) return;
    e.stopPropagation();
    onRequestAction({ kind: 'synonym', name: payload.name, targetName, type });
  }

  function handleListDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const payload = parseDragPayload(e) ?? dragPayload;
    if (!payload) return;
    if (payload.type === type) return;
    onRequestAction({ kind: 'reclassify', name: payload.name, fromType: payload.type, toType: type });
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
              key={item}
              draggable
              onDragStart={(e) => handleRowDragStart(e, item)}
              onDragEnd={onDragEnd}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => handleRowDrop(e, item)}
              onClick={() => onClickItem(item, type)}
              title="Klicken zum Bearbeiten. Ziehen: auf andere Liste = umwandeln, auf anderes Element = Synonym, unten = Blacklist"
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
              <span className="flex-1 min-w-0 truncate">{item}</span>
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
        {isOwnDrag ? `Hier fallen lassen, um als ${typeAccusative[type]} zu blacklisten` : 'Zum Blacklisten hierher ziehen'}
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

interface EntityEditDialogProps {
  type: EntityType;
  name: string;
  onClose: () => void;
  onSaved: () => void;
}

function EntityEditDialog({ type, name, onClose, onSaved }: EntityEditDialogProps) {
  const { request } = useApi();
  const { showSuccess, showError } = useError();
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [canonical, setCanonical] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [newAlias, setNewAlias] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await request<EntityDetail>(
        `/api/entities/detail?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`,
      );
      if (cancelled) return;
      if (!data) {
        setLoading(false);
        return;
      }
      setDetail(data);
      setCanonical(data.canonical);
      setAliases(data.aliases);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [request, type, name]);

  function addAlias() {
    const normalized = newAlias.trim();
    if (!normalized) return;
    if (normalized.toLowerCase() === canonical.trim().toLowerCase()) {
      showError('Synonym darf nicht gleich dem Hauptnamen sein.');
      return;
    }
    if (aliases.some((a) => a.toLowerCase() === normalized.toLowerCase())) {
      showError('Dieses Synonym existiert bereits.');
      return;
    }
    setAliases((prev) => [...prev, normalized]);
    setNewAlias('');
  }

  function removeAlias(index: number) {
    setAliases((prev) => prev.filter((_, i) => i !== index));
  }

  function updateAlias(index: number, value: string) {
    setAliases((prev) => {
      const copy = [...prev];
      copy[index] = value;
      return copy;
    });
  }

  async function handleSave() {
    const normalizedCanonical = canonical.trim();
    if (!normalizedCanonical) {
      showError('Hauptname ist erforderlich.');
      return;
    }

    const normalizedAliases = [
      ...new Set(
        aliases
          .map((a) => a.trim())
          .filter((a) => a.length > 0 && a.toLowerCase() !== normalizedCanonical.toLowerCase()),
      ),
    ];

    setSaving(true);
    const { error } = await request('/api/entities/detail', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        oldName: detail?.canonical ?? name,
        newName: normalizedCanonical,
        aliases: normalizedAliases,
      } as EntityUpdatePayload),
    });
    setSaving(false);

    if (!error) {
      showSuccess('Entität gespeichert.');
      onSaved();
      onClose();
    }
  }

  return (
    <Modal
      isOpen
      title={`${typeLabels[type]}: ${detail?.canonical ?? name}`}
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition disabled:opacity-50"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 rounded font-semibold bg-[var(--accent)] text-slate-900 hover:brightness-110 transition disabled:opacity-50"
          >
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="py-8 flex justify-center">
          <Loading size="md" />
        </div>
      ) : !detail ? (
        <p className="text-slate-400">Entität konnte nicht geladen werden.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-h)] mb-1">
              Hauptname
            </label>
            <input
              type="text"
              value={canonical}
              onChange={(e) => setCanonical(e.target.value)}
              className="w-full px-3 py-2 rounded bg-slate-900/50 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
              placeholder="Name"
            />
            <p className="text-xs text-slate-500 mt-1">
              Unter diesem Namen wird die {typeLabels[type]} in den Einträgen geführt.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-h)] mb-1">
              Synonyme
            </label>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {aliases.length === 0 ? (
                <p className="text-slate-500 text-sm italic">Noch keine Synonyme vorhanden.</p>
              ) : (
                aliases.map((alias, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={alias}
                      onChange={(e) => updateAlias(index, e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2 rounded bg-slate-900/50 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeAlias(index)}
                      title="Synonym entfernen"
                      className="p-2 rounded text-slate-500 hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition"
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
                ))
              )}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text"
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addAlias();
                  }
                }}
                placeholder="Neues Synonym"
                className="flex-1 min-w-0 px-3 py-2 rounded bg-slate-900/50 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={addAlias}
                disabled={!newAlias.trim()}
                className="px-3 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition disabled:opacity-50"
              >
                Hinzufügen
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function World() {
  const { request } = useApi();
  const { showSuccess } = useError();
  const [entities, setEntities] = useState<EntitiesResponse | null>(null);
  const [blacklists, setBlacklists] = useState<EntitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionWorking, setActionWorking] = useState(false);
  const [panelViews, setPanelViews] = useState<Record<EntityType, PanelView>>({
    persons: 'entities',
    organizations: 'entities',
    locations: 'entities',
  });
  const [selectedEntity, setSelectedEntity] = useState<{ name: string; type: EntityType } | null>(
    null,
  );
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
    const { data } = await request<EntitiesResponse>('/api/entities/blacklist');
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
        body = { name: action.name, fromType: action.fromType, toType: action.toType };
        break;
      case 'synonym':
        endpoint = '/api/entities/alias';
        body = { type: action.type, alias: action.name, canonical: action.targetName };
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

  function handleResetLayout() {
    localStorage.removeItem('world-layout-v1');
    setResetKey((k) => k + 1);
  }

  function handleDragStart(name: string, type: EntityType) {
    if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
    canClickRef.current = false;
    setDragPayload({ name, type });
  }

  function handleDragEnd() {
    if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
    clickTimeoutRef.current = setTimeout(() => {
      canClickRef.current = true;
    }, 200);
    setDragPayload(null);
  }

  function handleEntityClick(name: string, type: EntityType) {
    if (!canClickRef.current) return;
    setSelectedEntity({ name, type });
  }

  function handleCloseEdit() {
    setSelectedEntity(null);
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
            Soll <strong>{action.name}</strong> als{' '}
            {typeLabels[action.type]} in die Blacklist aufgenommen werden? Der Name wird
            aus der {typeAccusative[action.type]}-Liste entfernt und zukünftig nicht mehr
            als {typeLabels[action.type]} erkannt.
          </>
        );
      case 'unblacklist':
        return (
          <>
            Soll <strong>{action.name}</strong> aus der Blacklist für{' '}
            {typeAccusative[action.type]} entfernt werden? Der Name kann danach wieder als{' '}
            {typeLabels[action.type]} erkannt werden.
          </>
        );
      case 'reclassify':
        return (
          <>
            Soll <strong>{action.name}</strong> von{' '}
            {typeAccusative[action.fromType]} zu {typeAccusative[action.toType]} umgewandelt
            werden?
          </>
        );
      case 'synonym':
        return (
          <>
            Soll <strong>{action.name}</strong> als Synonym (Alias) für{' '}
            <strong>{action.targetName}</strong> gespeichert werden? Beide Namen werden
            zusammengeführt; zukünftige Erwähnungen von {action.name} werden als{' '}
            {action.targetName} erkannt.
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
      <div key={type}>
        <GridPanel
          title={isBlacklist ? `Blacklist – ${title}` : title}
          actions={
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
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
        </GridPanel>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6">
      <DashboardHeader title="Welt" onReset={handleResetLayout} />

      <DashboardLayout
        key={resetKey}
        storageKey="world-layout-v1"
        defaultLayout={[
          { i: 'persons', x: 0, y: 0, w: 4, h: 12, minW: 2, minH: 4 },
          { i: 'organizations', x: 4, y: 0, w: 4, h: 12, minW: 2, minH: 4 },
          { i: 'locations', x: 8, y: 0, w: 4, h: 12, minW: 2, minH: 4 },
        ]}
        className="flex-1 min-h-0"
        fitHeight
      >
        {renderPanel('persons', 'Personen', 'Noch keine Personen vorhanden.')}
        {renderPanel('organizations', 'Organisationen', 'Noch keine Organisationen vorhanden.')}
        {renderPanel('locations', 'Orte', 'Noch keine Orte vorhanden.')}
      </DashboardLayout>

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

      {selectedEntity && (
        <EntityEditDialog
          type={selectedEntity.type}
          name={selectedEntity.name}
          onClose={handleCloseEdit}
          onSaved={() => {
            load();
            loadBlacklists();
          }}
        />
      )}
    </div>
  );
}
