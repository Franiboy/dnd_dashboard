import { useEffect, useRef, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useEntityMappings } from '../hooks/useEntityMappings';
import { useError } from '../hooks/useError';
import { EntityRichText } from './EntityRichText';
import { Loading } from './Loading';
import { Modal } from './Modal';
import { formatEntityLabel, typeLabels } from '../lib/entityLabels';
import type {
  EntityDetail,
  EntityType,
  EntityUpdatePayload,
  EntityKnowledgeEntry,
} from '../../shared/types';

interface EntityEditDialogProps {
  type: EntityType;
  name: string;
  /** Disambiguator of the entity to open; '' targets the plain name. */
  qualifier?: string;
  onClose: () => void;
  onSaved?: () => void;
}

interface KnowledgeCorrectionResponse {
  created: EntityKnowledgeEntry[];
  deleted: { id: number; reason: string; entry: EntityKnowledgeEntry }[];
  summaries: {
    entityType: EntityType;
    entityName: string;
    entityQualifier?: string;
    summary: string | null;
    miniSummary: string | null;
  }[];
}

function parseOptionalDay(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n > 0 ? n : null;
}

interface CorrectKnowledgeDialogProps {
  type: EntityType;
  name: string;
  qualifier: string;
  onClose: () => void;
  onCorrected: (result: KnowledgeCorrectionResponse) => void;
}

function CorrectKnowledgeDialog({
  type,
  name,
  qualifier,
  onClose,
  onCorrected,
}: CorrectKnowledgeDialogProps) {
  const { request } = useApi();
  const { showSuccess, showError } = useError();
  const [text, setText] = useState('');
  const [working, setWorking] = useState(false);

  async function handleCorrect() {
    if (!text.trim()) return;
    setWorking(true);
    const { data, error } = await request<KnowledgeCorrectionResponse>(
      '/api/entities/knowledge/correct',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), type, name, qualifier }),
      }
    );
    setWorking(false);
    if (!error && data) {
      const parts: string[] = [];
      if (data.created.length) parts.push(`${data.created.length} neu`);
      if (data.deleted.length) parts.push(`${data.deleted.length} als gelöscht markiert`);
      if (data.summaries.some((s) => s.summary)) parts.push('Zusammenfassungen aktualisiert');
      showSuccess(
        parts.length ? `Wissen berichtigt: ${parts.join(', ')}.` : 'Keine Änderungen erkannt.'
      );
      onCorrected(data);
      onClose();
    } else if (error) {
      showError(error);
    }
  }

  return (
    <Modal
      isOpen
      title="Wissen korrigieren"
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
            onClick={handleCorrect}
            disabled={working || !text.trim()}
            className="px-4 py-2 rounded font-semibold bg-[var(--accent)] text-slate-900 hover:brightness-110 transition disabled:opacity-50"
          >
            {working ? 'Wird berichtigt...' : 'Berichtigen'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-400">
          Beschreibe, was am gespeicherten Wissen falsch ist. Die KI prüft die betroffenen
          Entitäten, markiert widersprüchliche Einträge als gelöscht, legt korrigierte Einträge an
          und aktualisiert die Zusammenfassungen.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          autoFocus
          placeholder="z. B. Vimak gehört nicht der Wagenwacht an, sondern den Silberkrähen."
          className="w-full px-3 py-2 rounded bg-slate-900/50 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none resize-y"
        />
      </div>
    </Modal>
  );
}

export function EntityEditDialog({
  type,
  name,
  qualifier = '',
  onClose,
  onSaved,
}: EntityEditDialogProps) {
  const { request } = useApi();
  const { mappings, refresh } = useEntityMappings();
  const { showSuccess, showError } = useError();
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [canonical, setCanonical] = useState('');
  const [qualifierValue, setQualifierValue] = useState(qualifier);
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
  const [editingKnowledgeValidUntil, setEditingKnowledgeValidUntil] = useState<string>('');
  const [newKnowledgeTitle, setNewKnowledgeTitle] = useState('');
  const [newKnowledgeContent, setNewKnowledgeContent] = useState('');
  const [newKnowledgeValidFrom, setNewKnowledgeValidFrom] = useState<string>('');
  const [newKnowledgeValidUntil, setNewKnowledgeValidUntil] = useState<string>('');
  const [currentGameDay, setCurrentGameDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'aliases' | 'knowledge'>('summary');
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const staleRef = useRef(false);

  // Canonical identity of the entity this dialog works on. After loading it
  // reflects the server-resolved row; before that it mirrors the props.
  const identityQualifier = detail?.qualifier ?? qualifier;

  useEffect(() => {
    staleRef.current = false;
    return () => {
      staleRef.current = true;
    };
  }, [name, type, qualifier]);

  useEffect(() => {
    setDetail(null);
    setCanonical(name);
    setQualifierValue(qualifier);
    setAliases([]);
    setKnowledge([]);
    setSummary(null);
    setMiniSummary(null);
    setSummaryDirty(true);
    setLoading(true);
  }, [name, type, qualifier]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: detailData } = await request<EntityDetail>(
        `/api/entities/detail?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}&qualifier=${encodeURIComponent(qualifier)}`
      );
      if (cancelled) return;
      if (!detailData) {
        setLoading(false);
        return;
      }

      const canonicalName = detailData.canonical;
      const canonicalQualifier = detailData.qualifier ?? '';
      const [{ data: knowledgeData }, { data: summaryData }] = await Promise.all([
        request<{ entries: EntityKnowledgeEntry[]; currentGameDay: number | null }>(
          `/api/entities/knowledge?type=${encodeURIComponent(type)}&name=${encodeURIComponent(canonicalName)}&qualifier=${encodeURIComponent(canonicalQualifier)}`
        ),
        request<{ summary: string | null; miniSummary: string | null; isDirty: boolean }>(
          `/api/entities/summary?type=${encodeURIComponent(type)}&name=${encodeURIComponent(canonicalName)}&qualifier=${encodeURIComponent(canonicalQualifier)}`
        ),
      ]);
      if (cancelled) return;

      setDetail(detailData);
      setCanonical(canonicalName);
      setQualifierValue(canonicalQualifier);
      setAliases(detailData.aliases);
      setKnowledge(knowledgeData?.entries || []);
      setCurrentGameDay(knowledgeData?.currentGameDay ?? null);
      setSummary(summaryData?.summary ?? null);
      setMiniSummary(summaryData?.miniSummary ?? null);
      setSummaryDirty(summaryData?.isDirty ?? true);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [request, type, name, qualifier]);

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
    setEditingKnowledgeValidUntil(entry.validUntil == null ? '' : String(entry.validUntil));
  }

  function cancelEditKnowledge() {
    setEditingKnowledgeId(null);
    setEditingKnowledgeTitle('');
    setEditingKnowledgeContent('');
    setEditingKnowledgeValidUntil('');
  }

  async function saveEditKnowledge(id: number) {
    if (!editingKnowledgeContent.trim()) {
      showError('Inhalt ist erforderlich');
      return;
    }
    const validUntil =
      editingKnowledgeValidUntil.trim() === '' ? null : Number(editingKnowledgeValidUntil);
    if (validUntil !== null && (!Number.isInteger(validUntil) || validUntil <= 0)) {
      showError('Gültig-bis-Spieltag muss eine positive ganze Zahl sein');
      return;
    }
    const { data, error } = await request<{ entry: EntityKnowledgeEntry }>(
      `/api/entities/knowledge/${id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editingKnowledgeTitle.trim() || null,
          content: editingKnowledgeContent.trim(),
          validUntil,
        }),
      }
    );
    if (staleRef.current) return;
    if (!error && data) {
      setKnowledge((prev) => prev.map((k) => (k.id === id ? data.entry : k)));
      cancelEditKnowledge();
      setSummaryDirty(true);
      showSuccess('Wissen aktualisiert.');
    }
  }

  async function handleDeleteKnowledge(id: number) {
    const { data, error } = await request<{ entry: EntityKnowledgeEntry }>(
      `/api/entities/knowledge/${id}`,
      { method: 'DELETE' }
    );
    if (staleRef.current) return;
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
    const validFrom = parseOptionalDay(newKnowledgeValidFrom);
    const validUntil = parseOptionalDay(newKnowledgeValidUntil);
    if (validFrom !== null && validUntil !== null && validUntil < validFrom) {
      showError('Gültig-bis-Spieltag darf nicht vor Gültig-ab-Spieltag liegen');
      return;
    }
    const { data, error } = await request<{ entry: EntityKnowledgeEntry }>(
      '/api/entities/knowledge',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          name: detail?.canonical ?? name,
          qualifier: identityQualifier,
          title: newKnowledgeTitle.trim() || null,
          content: newKnowledgeContent.trim(),
          validFrom,
          validUntil,
        }),
      }
    );
    if (staleRef.current) return;
    if (!error && data) {
      setKnowledge((prev) => [data.entry, ...prev]);
      setNewKnowledgeTitle('');
      setNewKnowledgeContent('');
      setNewKnowledgeValidFrom('');
      setNewKnowledgeValidUntil('');
      setSummaryDirty(true);
      showSuccess('Wissen hinzugefügt.');
    }
  }

  async function handleEndKnowledge(id: number) {
    if (currentGameDay == null) {
      showError('Noch kein Spieltag gesetzt – Gültigkeit kann nicht beendet werden.');
      return;
    }
    const { data, error } = await request<{ entry: EntityKnowledgeEntry }>(
      `/api/entities/knowledge/${id}/end`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ until: currentGameDay }),
      }
    );
    if (staleRef.current) return;
    if (!error && data) {
      setKnowledge((prev) => prev.map((k) => (k.id === id ? data.entry : k)));
      setSummaryDirty(true);
      showSuccess(`Fakt bis Spieltag ${currentGameDay} beendet (bleibt als Historie).`);
    }
  }

  async function handleGenerateSummary() {
    setGeneratingSummary(true);
    const { data, error } = await request<{ summary: string; miniSummary: string | null }>(
      '/api/entities/summary/generate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          name: detail?.canonical ?? name,
          qualifier: identityQualifier,
        }),
      }
    );
    if (staleRef.current) return;
    setGeneratingSummary(false);
    if (!error && data) {
      setSummary(data.summary);
      setMiniSummary(data.miniSummary);
      setSummaryDirty(false);
      showSuccess('Zusammenfassung generiert.');
    }
  }

  async function handleCorrected(result: KnowledgeCorrectionResponse) {
    const canonicalName = detail?.canonical ?? name;
    const { data } = await request<{ entries: EntityKnowledgeEntry[] }>(
      `/api/entities/knowledge?type=${encodeURIComponent(type)}&name=${encodeURIComponent(canonicalName)}&qualifier=${encodeURIComponent(identityQualifier)}`
    );
    if (staleRef.current) return;
    if (data) {
      setKnowledge(data.entries);
    }
    const updated = result.summaries.find(
      (s) =>
        s.entityType === type &&
        s.entityName.toLowerCase() === canonicalName.toLowerCase() &&
        (s.entityQualifier ?? '') === identityQualifier
    );
    if (updated && updated.summary) {
      setSummary(updated.summary);
      setMiniSummary(updated.miniSummary);
      setSummaryDirty(false);
    } else {
      setSummaryDirty(true);
    }
    await refresh();
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
    const { data, error } = await request<{ miniSummary: string | null }>(
      '/api/entities/mini-summary',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          name: detail?.canonical ?? name,
          qualifier: identityQualifier,
          miniSummary: text || null,
        }),
      }
    );
    if (staleRef.current) return;
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
    const normalizedQualifier = qualifierValue.trim();

    const normalizedAliases = [
      ...new Set(
        aliases
          .map((a) => a.trim())
          .filter(
            (a) =>
              a.length > 0 &&
              !(a.toLowerCase() === normalizedCanonical.toLowerCase() && !normalizedQualifier)
          )
      ),
    ];

    setSaving(true);
    const { error } = await request('/api/entities/detail', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        oldName: detail?.canonical ?? name,
        oldQualifier: identityQualifier,
        newName: normalizedCanonical,
        newQualifier: normalizedQualifier,
        aliases: normalizedAliases,
      } as EntityUpdatePayload),
    });
    if (staleRef.current) return;

    if (error) {
      setSaving(false);
      return;
    }

    showSuccess('Entität gespeichert.');
    await refresh();
    if (staleRef.current) return;
    setSaving(false);
    onSaved?.();
    onClose();
  }

  return (
    <>
      <Modal
        isOpen
        title={`${typeLabels[type]}: ${formatEntityLabel(detail?.canonical ?? name, detail?.qualifier ?? qualifier)}`}
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
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={canonical}
                  onChange={(e) => setCanonical(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-2 rounded bg-slate-900/50 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                  placeholder="Name"
                />
                <button
                  type="button"
                  onClick={() => setCorrectionOpen(true)}
                  title="Falsches Wissen per KI berichtigen"
                  className="text-xs px-3 py-2 rounded bg-[var(--accent)]/10 border border-[var(--accent)] text-[var(--accent)] font-semibold hover:bg-[var(--accent)]/20 transition whitespace-nowrap"
                >
                  Wissen korrigieren
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Unter diesem Namen wird die {typeLabels[type]} in den Einträgen geführt.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-h)] mb-1">
                Qualifier <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <input
                type="text"
                value={qualifierValue}
                onChange={(e) => setQualifierValue(e.target.value)}
                className="w-full px-3 py-2 rounded bg-slate-900/50 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                placeholder="z. B. Begleiter von Calzone"
              />
              <p className="text-xs text-slate-500 mt-1">
                Unterscheidet Entitäten mit gleichem Namen. Anzeige:{' '}
                <span className="text-slate-400">
                  {formatEntityLabel(canonical.trim() || 'Name', qualifierValue.trim())}
                </span>
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
                      {generatingSummary
                        ? 'Wird generiert...'
                        : summary
                          ? 'Aktualisieren'
                          : 'Generieren'}
                    </button>
                  )}
                </div>
                {summary ? (
                  <div
                    className={`text-sm text-[var(--text-h)] p-2 rounded border border-[var(--border)] ${summaryDirty ? 'bg-amber-900/20' : 'bg-slate-900/50'}`}
                  >
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
                    <p className="text-sm text-slate-500 italic">
                      Noch keine Mini-Zusammenfassung vorhanden.
                    </p>
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
                    <p className="text-slate-500 text-sm italic">
                      Noch keine Wissenseinträge vorhanden.
                    </p>
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
                              <div className="flex items-center gap-2">
                                <label className="text-[10px] text-slate-500 whitespace-nowrap">
                                  Gültig bis Spieltag
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  value={editingKnowledgeValidUntil}
                                  onChange={(e) => setEditingKnowledgeValidUntil(e.target.value)}
                                  placeholder="offen"
                                  className="w-24 px-2 py-1 text-sm rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                                />
                              </div>
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
                              <div className="flex flex-wrap items-center gap-2">
                                {entry.title && (
                                  <p
                                    className={`text-xs font-semibold ${isDeleted ? 'text-slate-500 line-through' : 'text-[var(--accent)]'}`}
                                  >
                                    {entry.title}
                                  </p>
                                )}
                                {isDeleted && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--danger)]/10 text-[var(--danger)] font-medium">
                                    Gelöscht
                                  </span>
                                )}
                                {entry.originType && (
                                  <span
                                    title={
                                      entry.originType === 'diary'
                                        ? `Aus Tagebucheintrag übernommen${entry.originTitle ? `: „${entry.originTitle}“` : ''}`
                                        : `Aus Session-Zusammenfassung übernommen${entry.originTitle ? `: ${entry.originTitle}` : ''}`
                                    }
                                    className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-medium whitespace-nowrap"
                                  >
                                    Quelle: {entry.originType === 'diary' ? 'Tagebuch' : 'Session'}
                                    {entry.originTitle ? ` „${entry.originTitle}“` : ''}
                                  </span>
                                )}
                                {(entry.validFrom !== null ||
                                  (!isDeleted && entry.validUntil !== null)) &&
                                  (() => {
                                    // valid_until is EXCLUSIVE: the fact holds up to
                                    // (validUntil - 1), so it is over now when
                                    // validUntil <= current day.
                                    const isOver =
                                      !isDeleted &&
                                      entry.validUntil !== null &&
                                      currentGameDay != null &&
                                      entry.validUntil <= currentGameDay;
                                    const lastValid =
                                      entry.validUntil !== null ? entry.validUntil - 1 : null;
                                    return (
                                      <span
                                        title={
                                          entry.validUntil !== null
                                            ? `Gültig von Spieltag ${entry.validFrom ?? 'Beginn'} bis einschließlich Spieltag ${lastValid}; ab Spieltag ${entry.validUntil} nicht mehr.`
                                            : `Gültig ab Spieltag ${entry.validFrom ?? 'Beginn'}.`
                                        }
                                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${
                                          isOver
                                            ? 'bg-amber-500/10 text-amber-400'
                                            : 'bg-[var(--accent)]/10 text-[var(--accent)]'
                                        }`}
                                      >
                                        {entry.validUntil !== null
                                          ? `Spieltag ${entry.validFrom ?? '…'} bis Tag ${lastValid}`
                                          : `Spieltag ab ${entry.validFrom ?? '…'}`}
                                      </span>
                                    );
                                  })()}
                              </div>
                              <p
                                className={`text-sm whitespace-pre-wrap ${isDeleted ? 'text-slate-500 line-through' : 'text-[var(--text-h)]'}`}
                              >
                                <EntityRichText
                                  content={entry.content}
                                  mappings={mappings}
                                  isHtml={false}
                                />
                              </p>
                              {isDeleted && entry.statusReason && (
                                <p className="text-xs text-slate-500 italic">
                                  Grund: {entry.statusReason}
                                </p>
                              )}
                              {!isDeleted && entry.validUntil !== null && entry.statusReason && (
                                <p className="text-xs text-slate-500 italic">
                                  Grund: {entry.statusReason}
                                </p>
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
                                  {entry.validUntil === null && currentGameDay != null && (
                                    <button
                                      type="button"
                                      onClick={() => handleEndKnowledge(entry.id)}
                                      title={`Fakt endet am aktuellen Spieltag ${currentGameDay} (bleibt als Historie)`}
                                      className="text-xs text-slate-500 hover:text-[var(--accent)] transition"
                                    >
                                      Beenden
                                    </button>
                                  )}
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
                  {(currentGameDay ?? null) !== null && (
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-slate-500 whitespace-nowrap">
                        Gültig ab
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={newKnowledgeValidFrom}
                        onChange={(e) => setNewKnowledgeValidFrom(e.target.value)}
                        placeholder={`aktuell ${currentGameDay}`}
                        className="w-24 px-2 py-1 text-sm rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                      />
                      <label className="text-[10px] text-slate-500 whitespace-nowrap">bis</label>
                      <input
                        type="number"
                        min={1}
                        value={newKnowledgeValidUntil}
                        onChange={(e) => setNewKnowledgeValidUntil(e.target.value)}
                        placeholder="offen"
                        className="w-24 px-2 py-1 text-sm rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                      />
                    </div>
                  )}
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
      {correctionOpen && (
        <CorrectKnowledgeDialog
          type={type}
          name={detail?.canonical ?? name}
          qualifier={identityQualifier}
          onClose={() => setCorrectionOpen(false)}
          onCorrected={handleCorrected}
        />
      )}
    </>
  );
}
