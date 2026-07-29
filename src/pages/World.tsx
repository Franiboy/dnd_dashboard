import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useEntityMappings } from '../hooks/useEntityMappings';
import { useError } from '../hooks/useError';
import { EntityRichText } from '../components/EntityRichText';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DashboardHeader } from '../components/DashboardHeader';
import { DashboardLayout } from '../components/DashboardLayout';
import { GridPanel } from '../components/GridPanel';
import { Loading } from '../components/Loading';
import { Modal } from '../components/Modal';
import type { EntitiesResponse, EntityDetail, EntityType, EntityUpdatePayload, EntityKnowledgeEntry } from '../../shared/types';

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
  const { mappings } = useEntityMappings();
  const { showSuccess, showError } = useError();
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [canonical, setCanonical] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [newAlias, setNewAlias] = useState('');
  const [knowledge, setKnowledge] = useState<EntityKnowledgeEntry[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [miniSummary, setMiniSummary] = useState<string | null>(null);
  const [editingMiniSummary, setEditingMiniSummary] = useState(false);
  const [editingMiniSummaryText, setEditingMiniSummaryText] = useState('');
  const [summaryDirty, setSummaryDirty] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [editingKnowledgeId, setEditingKnowledgeId] = useState<number | null>(null);
  const [editingKnowledgeTitle, setEditingKnowledgeTitle] = useState('');
  const [editingKnowledgeContent, setEditingKnowledgeContent] = useState('');
  const [newKnowledgeTitle, setNewKnowledgeTitle] = useState('');
  const [newKnowledgeContent, setNewKnowledgeContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'aliases' | 'knowledge'>('summary');

  useEffect(() => {
    setDetail(null);
    setCanonical(name);
    setAliases([]);
    setKnowledge([]);
    setSummary(null);
    setMiniSummary(null);
    setSummaryDirty(true);
    setLoading(true);
  }, [name, type]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: detailData } = await request<EntityDetail>(
        `/api/entities/detail?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`,
      );
      if (cancelled) return;
      if (!detailData) {
        setLoading(false);
        return;
      }

      const canonicalName = detailData.canonical;
      const [{ data: knowledgeData }, { data: summaryData }] = await Promise.all([
        request<{ entries: EntityKnowledgeEntry[] }>(
          `/api/entities/knowledge?type=${encodeURIComponent(type)}&name=${encodeURIComponent(canonicalName)}`,
        ),
        request<{ summary: string | null; miniSummary: string | null; isDirty: boolean }>(
          `/api/entities/summary?type=${encodeURIComponent(type)}&name=${encodeURIComponent(canonicalName)}`,
        ),
      ]);
      if (cancelled) return;

      setDetail(detailData);
      setCanonical(canonicalName);
      setAliases(detailData.aliases);
      setKnowledge(knowledgeData?.entries || []);
      setSummary(summaryData?.summary ?? null);
      setMiniSummary(summaryData?.miniSummary ?? null);
      setSummaryDirty(summaryData?.isDirty ?? true);
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

  function startEditKnowledge(entry: EntityKnowledgeEntry) {
    setEditingKnowledgeId(entry.id);
    setEditingKnowledgeTitle(entry.title || '');
    setEditingKnowledgeContent(entry.content);
  }

  function cancelEditKnowledge() {
    setEditingKnowledgeId(null);
    setEditingKnowledgeTitle('');
    setEditingKnowledgeContent('');
  }

  async function saveEditKnowledge(id: number) {
    if (!editingKnowledgeContent.trim()) {
      showError('Inhalt ist erforderlich');
      return;
    }
    const { data, error } = await request<{ entry: EntityKnowledgeEntry }>(`/api/entities/knowledge/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: editingKnowledgeTitle.trim() || null,
        content: editingKnowledgeContent.trim(),
      }),
    });
    if (!error && data) {
      setKnowledge((prev) => prev.map((k) => (k.id === id ? data.entry : k)));
      cancelEditKnowledge();
      setSummaryDirty(true);
      showSuccess('Wissen aktualisiert.');
    }
  }

  async function handleDeleteKnowledge(id: number) {
    const { data, error } = await request<{ entry: EntityKnowledgeEntry }>(`/api/entities/knowledge/${id}`, { method: 'DELETE' });
    if (!error && data) {
      setKnowledge((prev) => prev.map((k) => (k.id === id ? data.entry : k)));
      setSummaryDirty(true);
      showSuccess('Wissen als gelöscht markiert.');
    }
  }

  async function handleAddKnowledge() {
    if (!newKnowledgeContent.trim()) {
      showError('Inhalt ist erforderlich');
      return;
    }
    const { data, error } = await request<{ entry: EntityKnowledgeEntry }>('/api/entities/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        name: detail?.canonical ?? name,
        title: newKnowledgeTitle.trim() || null,
        content: newKnowledgeContent.trim(),
      }),
    });
    if (!error && data) {
      setKnowledge((prev) => [data.entry, ...prev]);
      setNewKnowledgeTitle('');
      setNewKnowledgeContent('');
      setSummaryDirty(true);
      showSuccess('Wissen hinzugefügt.');
    }
  }

  async function handleGenerateSummary() {
    setGeneratingSummary(true);
    const { data, error } = await request<{ summary: string; miniSummary: string | null }>('/api/entities/summary/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, name: detail?.canonical ?? name }),
    });
    setGeneratingSummary(false);
    if (!error && data) {
      setSummary(data.summary);
      setMiniSummary(data.miniSummary);
      setSummaryDirty(false);
      showSuccess('Zusammenfassung generiert.');
    }
  }

  function startEditMiniSummary() {
    setEditingMiniSummaryText(miniSummary ?? '');
    setEditingMiniSummary(true);
  }

  function cancelEditMiniSummary() {
    setEditingMiniSummary(false);
    setEditingMiniSummaryText('');
  }

  async function saveMiniSummary() {
    const text = editingMiniSummaryText.trim();
    if (text.length > 200) {
      showError('Mini-Zusammenfassung darf maximal 200 Zeichen haben');
      return;
    }
    const { data, error } = await request<{ miniSummary: string | null }>('/api/entities/mini-summary', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, name: detail?.canonical ?? name, miniSummary: text || null }),
    });
    if (!error && data) {
      setMiniSummary(data.miniSummary);
      setEditingMiniSummary(false);
      showSuccess('Mini-Zusammenfassung gespeichert.');
    }
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
      className="max-w-xl"
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

          <div className="border-b border-[var(--border)]">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('summary')}
                className={`px-3 py-1.5 text-sm font-medium border-b-2 transition ${
                  activeTab === 'summary'
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-transparent text-slate-400 hover:text-[var(--text-h)]'
                }`}
              >
                Zusammenfassung
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('aliases')}
                className={`px-3 py-1.5 text-sm font-medium border-b-2 transition ${
                  activeTab === 'aliases'
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-transparent text-slate-400 hover:text-[var(--text-h)]'
                }`}
              >
                Synonyme
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('knowledge')}
                className={`px-3 py-1.5 text-sm font-medium border-b-2 transition ${
                  activeTab === 'knowledge'
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-transparent text-slate-400 hover:text-[var(--text-h)]'
                }`}
              >
                Wissen
              </button>
            </div>
          </div>

          {activeTab === 'summary' && (
            <div>
              <div className="flex items-center justify-end mb-1">
                {(summaryDirty || !summary) && (
                  <button
                    type="button"
                    onClick={handleGenerateSummary}
                    disabled={generatingSummary}
                    className="text-xs px-2 py-1 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:brightness-110 transition disabled:opacity-50"
                  >
                    {generatingSummary ? 'Wird generiert...' : summary ? 'Aktualisieren' : 'Generieren'}
                  </button>
                )}
              </div>
              {summary ? (
                <div className={`text-sm text-[var(--text-h)] p-2 rounded border border-[var(--border)] ${summaryDirty ? 'bg-amber-900/20' : 'bg-slate-900/50'}`}>
                  <p className="whitespace-pre-wrap">
                    <EntityRichText content={summary} mappings={mappings} isHtml={false} />
                  </p>
                  {summaryDirty && (
                    <p className="text-xs text-amber-500 mt-1 italic">
                      Zusammenfassung ist veraltet und sollte aktualisiert werden.
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-sm text-slate-500 italic p-2 rounded border border-dashed border-[var(--border)] bg-slate-900/30">
                  Noch keine Zusammenfassung vorhanden.
                </div>
              )}

              <div className="mt-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-[var(--text-h)]">Mini-Zusammenfassung</p>
                  {!editingMiniSummary && (
                    <button
                      type="button"
                      onClick={startEditMiniSummary}
                      title="Mini-Zusammenfassung bearbeiten"
                      className="text-xs text-slate-500 hover:text-[var(--accent)] transition"
                    >
                      Bearbeiten
                    </button>
                  )}
                </div>
                {editingMiniSummary ? (
                  <div className="space-y-2">
                    <textarea
                      value={editingMiniSummaryText}
                      onChange={(e) => setEditingMiniSummaryText(e.target.value)}
                      rows={2}
                      maxLength={200}
                      className="w-full px-2 py-1 text-sm rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none resize-y"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={saveMiniSummary}
                        disabled={editingMiniSummaryText.trim().length > 200}
                        className="text-xs px-2 py-1 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:brightness-110 transition disabled:opacity-50"
                      >
                        Speichern
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditMiniSummary}
                        className="text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition"
                      >
                        Abbrechen
                      </button>
                    </div>
                  </div>
                ) : miniSummary ? (
                  <p className="text-sm text-slate-300 whitespace-pre-wrap">{miniSummary}</p>
                ) : (
                  <p className="text-sm text-slate-500 italic">Noch keine Mini-Zusammenfassung vorhanden.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'aliases' && (
            <div>
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
          )}

          {activeTab === 'knowledge' && (
            <div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {knowledge.length === 0 ? (
                  <p className="text-slate-500 text-sm italic">Noch keine Wissenseinträge vorhanden.</p>
                ) : (
                  knowledge.map((entry) => {
                    const isDeleted = entry.status === 'deleted';
                    return (
                      <div
                        key={entry.id}
                        className={`space-y-1 p-2 rounded border border-[var(--border)] ${
                          isDeleted ? 'bg-slate-900/20 opacity-70' : 'bg-slate-900/50'
                        }`}
                      >
                        {editingKnowledgeId === entry.id ? (
                          <>
                            <input
                              type="text"
                              value={editingKnowledgeTitle}
                              onChange={(e) => setEditingKnowledgeTitle(e.target.value)}
                              placeholder="Titel (optional)"
                              className="w-full px-2 py-1 text-sm rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                            />
                            <textarea
                              value={editingKnowledgeContent}
                              onChange={(e) => setEditingKnowledgeContent(e.target.value)}
                              rows={2}
                              className="w-full px-2 py-1 text-sm rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none resize-y"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => saveEditKnowledge(entry.id)}
                                className="text-xs px-2 py-1 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:brightness-110 transition"
                              >
                                Speichern
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditKnowledge}
                                className="text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition"
                              >
                                Abbrechen
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              {entry.title && (
                                <p className={`text-xs font-semibold ${isDeleted ? 'text-slate-500 line-through' : 'text-[var(--accent)]'}`}>
                                  {entry.title}
                                </p>
                              )}
                              {isDeleted && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--danger)]/10 text-[var(--danger)] font-medium">
                                  Gelöscht
                                </span>
                              )}
                            </div>
                            <p className={`text-sm whitespace-pre-wrap ${isDeleted ? 'text-slate-500 line-through' : 'text-[var(--text-h)]'}`}>
                              <EntityRichText content={entry.content} mappings={mappings} isHtml={false} />
                            </p>
                            {isDeleted && entry.statusReason && (
                              <p className="text-xs text-slate-500 italic">Grund: {entry.statusReason}</p>
                            )}
                            {!isDeleted && (
                              <div className="flex gap-2 justify-end">
                                <button
                                  type="button"
                                  onClick={() => startEditKnowledge(entry)}
                                  title="Bearbeiten"
                                  className="text-xs text-slate-500 hover:text-[var(--accent)] transition"
                                >
                                  Bearbeiten
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteKnowledge(entry.id)}
                                  title="Als ungültig markieren"
                                  className="text-xs text-slate-500 hover:text-[var(--danger)] transition"
                                >
                                  Ungültig
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="space-y-1 mt-2 p-2 rounded bg-slate-900/30 border border-dashed border-[var(--border)]">
                <input
                  type="text"
                  value={newKnowledgeTitle}
                  onChange={(e) => setNewKnowledgeTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleAddKnowledge();
                    }
                  }}
                  placeholder="Titel (optional)"
                  className="w-full px-2 py-1 text-sm rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                />
                <textarea
                  value={newKnowledgeContent}
                  onChange={(e) => setNewKnowledgeContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.ctrlKey) {
                      e.preventDefault();
                      handleAddKnowledge();
                    }
                  }}
                  rows={2}
                  placeholder="Neuer Wissenseintrag"
                  className="w-full px-2 py-1 text-sm rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none resize-y"
                />
                <button
                  type="button"
                  onClick={handleAddKnowledge}
                  disabled={!newKnowledgeContent.trim()}
                  className="w-full text-xs px-3 py-1 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition disabled:opacity-50"
                >
                  Hinzufügen
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
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
    const { data, error } = await request<{ created: EntityKnowledgeEntry[]; deleted: { id: number; reason: string; entry: EntityKnowledgeEntry }[] }>(
      '/api/entities/knowledge/distribute',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      },
    );
    setWorking(false);
    if (!error && data) {
      const parts: string[] = [];
      if (data.created.length) parts.push(`${data.created.length} neu`);
      if (data.deleted.length) parts.push(`${data.deleted.length} als gelöscht markiert`);
      showSuccess(parts.length ? `Wissen eingeordnet: ${parts.join(', ')}.` : 'Keine Änderungen erkannt.');
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
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedEntity, setSelectedEntity] = useState<{ name: string; type: EntityType } | null>(
    (location.state as { selectedEntity?: { name: string; type: EntityType } } | null)?.selectedEntity ?? null,
  );
  const [distributeOpen, setDistributeOpen] = useState(false);

  useEffect(() => {
    if ((location.state as { selectedEntity?: unknown } | null)?.selectedEntity) {
      navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true });
    }
  }, [location, navigate]);

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
      <DashboardHeader title="Welt" onReset={handleResetLayout}>
        <button
          type="button"
          onClick={() => setDistributeOpen(true)}
          className="px-4 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:brightness-110 transition"
        >
          Wissen einordnen
        </button>
      </DashboardHeader>

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
