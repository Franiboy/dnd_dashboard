import { useEffect, useRef, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useEntityMappings } from '../hooks/useEntityMappings';
import { useError } from '../hooks/useError';
import { useI18n } from '../hooks/useI18n';
import { useStoryArcs } from '../hooks/useStoryArcs';
import { EntityRichText } from './EntityRichText';
import { Loading } from './Loading';
import { Modal } from './Modal';
import { ChapterStatusDot } from './storyArcs/ChapterStatusDot';
import { formatEntityLabel, getEntityTypeLabel } from '../lib/entityLabels';
import type { TFunction } from '../i18n';
import type { EntityDialogTab } from '../contexts/EntityDialogContext';
import type {
  EntityDetail,
  EntityType,
  EntityUpdatePayload,
  EntityKnowledgeEntry,
  StoryArcStatus,
} from '../../shared/types';

interface EntityEditDialogProps {
  type: EntityType;
  name: string;
  /** Disambiguator of the entity to open; '' targets the plain name. */
  qualifier?: string;
  /** Tab shown on mount (e.g. global search opens knowledge hits there). */
  initialTab?: EntityDialogTab;
  onClose: () => void;
  onSaved?: () => void;
}

interface KnowledgeCorrectionResponse {
  created: EntityKnowledgeEntry[];
  ended: { id: number; reason: string; entry: EntityKnowledgeEntry }[];
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

function localizedArcStatus(status: StoryArcStatus, t: TFunction): string {
  return t(
    status === 'active'
      ? 'world.arcStatus.active'
      : status === 'planned'
        ? 'world.arcStatus.planned'
        : 'world.arcStatus.completed'
  );
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
  const { t, formatNumber } = useI18n();
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
      if (data.created.length) {
        parts.push(
          t('world.entity.correction.created', {
            count: data.created.length,
            formattedCount: formatNumber(data.created.length),
          })
        );
      }
      if (data.deleted.length) {
        parts.push(
          t('world.entity.correction.deleted', {
            count: data.deleted.length,
            formattedCount: formatNumber(data.deleted.length),
          })
        );
      }
      if (data.summaries.some((s) => s.summary)) {
        parts.push(t('world.entity.correction.summariesUpdated'));
      }
      showSuccess(
        parts.length
          ? t('world.entity.correction.success', { parts: parts.join(', ') })
          : t('world.entity.correction.noChanges')
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
      title={t('world.entity.correction.title')}
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition disabled:opacity-50"
          >
            {t('shared.cancel')}
          </button>
          <button
            type="button"
            onClick={handleCorrect}
            disabled={working || !text.trim()}
            className="px-4 py-2 rounded font-semibold bg-[var(--accent)] text-[var(--accent-contrast)] hover:brightness-110 transition disabled:opacity-50"
          >
            {working
              ? t('world.entity.correction.processing')
              : t('world.entity.correction.action')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-400">{t('world.entity.correction.description')}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          autoFocus
          aria-label={t('world.entity.correction.title')}
          placeholder={t('world.entity.correction.placeholder')}
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
  initialTab,
  onClose,
  onSaved,
}: EntityEditDialogProps) {
  const { request } = useApi();
  const { mappings, refresh } = useEntityMappings();
  const { showSuccess, showError } = useError();
  const { t, formatNumber } = useI18n();
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
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle'
  );
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'summary' | 'aliases' | 'knowledge' | 'arcs'>(
    initialTab ?? 'summary'
  );
  const [arcLinks, setArcLinks] = useState<number[]>([]);
  const [togglingArcIds, setTogglingArcIds] = useState<Set<number>>(new Set());
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const { arcs: storyArcs, selectedArcId } = useStoryArcs();
  // When the global arc filter is set, knowledge is shown for that arc only
  // (its derived day range); 'none' and unfiltered views show everything.
  const dialogArcParam = typeof selectedArcId === 'number' ? String(selectedArcId) : null;
  const staleRef = useRef(false);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeAfterAutoSaveRef = useRef(false);
  const lastSavedRef = useRef<{ canonical: string; qualifier: string; aliases: string[] } | null>(
    null
  );
  const hasInitializedRef = useRef(false);

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
    // oxlint-disable react/set-state-in-effect -- editor state resets when the
    // edited entity identity (name/type/qualifier) changes.
    setDetail(null);
    setCanonical(name);
    setQualifierValue(qualifier);
    setAliases([]);
    setKnowledge([]);
    setSummary(null);
    setMiniSummary(null);
    // oxlint-enable react/set-state-in-effect
    setSummaryDirty(true);
    setLoading(true);
    setAutoSaveStatus('idle');
    setAutoSaveError(null);
    lastSavedRef.current = null;
    hasInitializedRef.current = false;
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
    closeAfterAutoSaveRef.current = false;
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
      const [{ data: summaryData }, { data: arcLinksData }] = await Promise.all([
        request<{ summary: string | null; miniSummary: string | null; isDirty: boolean }>(
          `/api/entities/summary?type=${encodeURIComponent(type)}&name=${encodeURIComponent(canonicalName)}&qualifier=${encodeURIComponent(canonicalQualifier)}`
        ),
        request<{ arcIds: number[] }>(
          `/api/entities/arc-links?type=${encodeURIComponent(type)}&name=${encodeURIComponent(canonicalName)}&qualifier=${encodeURIComponent(canonicalQualifier)}`
        ),
      ]);
      if (cancelled) return;

      setDetail(detailData);
      setCanonical(canonicalName);
      setQualifierValue(canonicalQualifier);
      setAliases(detailData.aliases);
      setArcLinks(arcLinksData?.arcIds ?? []);
      setSummary(summaryData?.summary ?? null);
      setMiniSummary(summaryData?.miniSummary ?? null);
      setSummaryDirty(summaryData?.isDirty ?? true);
      lastSavedRef.current = {
        canonical: canonicalName,
        qualifier: canonicalQualifier,
        aliases: detailData.aliases,
      };
      hasInitializedRef.current = true;
      setAutoSaveStatus('idle');
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [request, type, name, qualifier]);

  // Knowledge list: refetched when the entity identity or the global arc
  // filter changes (arc-filtered views show the arc's day-range slice).
  const canonicalIdentity = detail?.canonical ?? null;
  const canonicalQualifierIdentity = detail?.qualifier ?? null;
  useEffect(() => {
    if (!canonicalIdentity) return;
    let cancelled = false;
    const loadKnowledge = async () => {
      const arcQuery = dialogArcParam ? `&arcId=${dialogArcParam}` : '';
      const { data } = await request<{
        entries: EntityKnowledgeEntry[];
        currentGameDay: number | null;
      }>(
        `/api/entities/knowledge?type=${encodeURIComponent(type)}&name=${encodeURIComponent(canonicalIdentity)}&qualifier=${encodeURIComponent(canonicalQualifierIdentity ?? '')}${arcQuery}`
      );
      if (cancelled) return;
      if (data) {
        setKnowledge(data.entries);
        setCurrentGameDay(data.currentGameDay ?? null);
      }
    };
    void loadKnowledge();
    return () => {
      cancelled = true;
    };
  }, [canonicalIdentity, canonicalQualifierIdentity, dialogArcParam, request, type]);

  // Autosave for canonical, qualifier and aliases — debounced 600ms, no explicit Save/Cancel.
  useEffect(() => {
    if (loading || !detail || !hasInitializedRef.current || !lastSavedRef.current) return;

    const normalizedCanonical = canonical.trim();
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

    const last = lastSavedRef.current;
    const aliasesEqual =
      last.aliases.length === normalizedAliases.length &&
      last.aliases.every((v, i) => v === normalizedAliases[i]);

    if (
      last.canonical === normalizedCanonical &&
      last.qualifier === normalizedQualifier &&
      aliasesEqual
    ) {
      return;
    }

    // Don't auto-save while canonical is empty — show inline error instead.
    if (!normalizedCanonical) {
      // Autosave validation reacts to identity changes above.
      // oxlint-disable-next-line react/set-state-in-effect
      setAutoSaveStatus('error');
      // oxlint-disable-next-line react/set-state-in-effect
      setAutoSaveError(t('world.entity.autosave.required'));
      return;
    }
    setAutoSaveError(null);

    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);

    autoSaveTimeoutRef.current = setTimeout(async () => {
      autoSaveTimeoutRef.current = null;
      const oldName = detail.canonical;
      const oldQualifier = detail.qualifier ?? '';
      // Skip if detail already matches target (e.g. after successful save)
      const currentLast = lastSavedRef.current;
      if (
        currentLast &&
        currentLast.canonical === normalizedCanonical &&
        currentLast.qualifier === normalizedQualifier &&
        currentLast.aliases.length === normalizedAliases.length &&
        currentLast.aliases.every((v, i) => v === normalizedAliases[i])
      ) {
        return;
      }

      setAutoSaveStatus('saving');
      const { error } = await request('/api/entities/detail', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          oldName,
          oldQualifier,
          newName: normalizedCanonical,
          newQualifier: normalizedQualifier,
          aliases: normalizedAliases,
        } as EntityUpdatePayload),
      });
      if (staleRef.current) return;
      if (error) {
        closeAfterAutoSaveRef.current = false;
        setAutoSaveStatus('error');
        setAutoSaveError(error);
        return;
      }
      lastSavedRef.current = {
        canonical: normalizedCanonical,
        qualifier: normalizedQualifier,
        aliases: normalizedAliases,
      };
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              canonical: normalizedCanonical,
              qualifier: normalizedQualifier,
              aliases: normalizedAliases,
            }
          : prev
      );
      setAutoSaveStatus('saved');
      await refresh();
      if (staleRef.current) return;
      onSaved?.();
      if (closeAfterAutoSaveRef.current) {
        closeAfterAutoSaveRef.current = false;
        onClose();
        return;
      }
      // Reset "saved" indicator back to idle after a short delay
      setTimeout(() => {
        if (!staleRef.current) setAutoSaveStatus('idle');
      }, 2000);
    }, 600);

    return () => {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    };
  }, [
    canonical,
    qualifierValue,
    aliases,
    detail,
    loading,
    onClose,
    onSaved,
    refresh,
    request,
    t,
    type,
  ]);

  function handleClose() {
    if (autoSaveTimeoutRef.current) {
      closeAfterAutoSaveRef.current = true;
      return;
    }
    onClose();
  }

  // Cancel only the timer on unmount; an in-flight request is allowed to finish.
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    };
  }, []);

  function addAlias() {
    const normalized = newAlias.trim();
    if (!normalized) return;
    if (normalized.toLowerCase() === canonical.trim().toLowerCase()) {
      showError(t('world.entity.aliases.sameAsCanonical'));
      return;
    }
    if (aliases.some((a) => a.toLowerCase() === normalized.toLowerCase())) {
      showError(t('world.entity.aliases.duplicate'));
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
      showError(t('world.entity.knowledge.contentRequired'));
      return;
    }
    const validUntil =
      editingKnowledgeValidUntil.trim() === '' ? null : Number(editingKnowledgeValidUntil);
    if (validUntil !== null && (!Number.isInteger(validUntil) || validUntil <= 0)) {
      showError(t('world.entity.knowledge.validUntilPositive'));
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
      showSuccess(t('world.entity.knowledge.updatedSuccess'));
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
      showSuccess(t('world.entity.knowledge.deletedSuccess'));
    }
  }

  async function handleAddKnowledge() {
    if (!newKnowledgeContent.trim()) {
      showError(t('world.entity.knowledge.contentRequired'));
      return;
    }
    const validFrom = parseOptionalDay(newKnowledgeValidFrom);
    const validUntil = parseOptionalDay(newKnowledgeValidUntil);
    if (validFrom !== null && validUntil !== null && validUntil < validFrom) {
      showError(t('world.entity.knowledge.validRangeOrder'));
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
      showSuccess(t('world.entity.knowledge.addedSuccess'));
    }
  }

  async function handleEndKnowledge(id: number) {
    if (currentGameDay == null) {
      showError(t('world.entity.knowledge.noCurrentDay'));
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
      showSuccess(t('world.entity.knowledge.ended', { day: formatNumber(currentGameDay) }));
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
      showSuccess(t('world.entity.knowledge.summarySuccess'));
    }
  }

  async function handleCorrected(result: KnowledgeCorrectionResponse) {
    const canonicalName = detail?.canonical ?? name;
    const arcQuery = dialogArcParam ? `&arcId=${dialogArcParam}` : '';
    const { data } = await request<{ entries: EntityKnowledgeEntry[] }>(
      `/api/entities/knowledge?type=${encodeURIComponent(type)}&name=${encodeURIComponent(canonicalName)}&qualifier=${encodeURIComponent(identityQualifier)}${arcQuery}`
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

  async function handleReviewKnowledge() {
    if (reviewing) return;
    setReviewing(true);
    const { data, error } = await request<KnowledgeCorrectionResponse>(
      '/api/entities/knowledge/review',
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
    setReviewing(false);
    if (!error && data) {
      const parts: string[] = [];
      if (data.created.length) {
        parts.push(
          t('world.entity.knowledge.reviewChanges.created', {
            count: data.created.length,
            formattedCount: formatNumber(data.created.length),
          })
        );
      }
      if (data.ended.length) {
        parts.push(
          t('world.entity.knowledge.reviewChanges.ended', {
            count: data.ended.length,
            formattedCount: formatNumber(data.ended.length),
          })
        );
      }
      if (data.deleted.length) {
        parts.push(
          t('world.entity.knowledge.reviewChanges.deleted', {
            count: data.deleted.length,
            formattedCount: formatNumber(data.deleted.length),
          })
        );
      }
      if (data.summaries.some((s) => s.summary)) {
        parts.push(t('world.entity.knowledge.reviewChanges.summaryUpdated'));
      }
      showSuccess(
        parts.length
          ? t('world.entity.knowledge.reviewSuccess', { parts: parts.join(', ') })
          : t('world.entity.knowledge.reviewNoChanges')
      );
      await handleCorrected(data);
    } else if (error) {
      showError(error);
    }
  }

  function startEditMiniSummary() {
    setEditingMiniSummaryText(miniSummary ?? '');
    setEditingMiniSummary(true);
  }

  async function toggleArcLink(arcId: number, linked: boolean) {
    // Per-arc busy flag: rapid re-toggles wait until the in-flight request of
    // this arc has finished (checkbox is disabled while toggling).
    setTogglingArcIds((prev) => new Set(prev).add(arcId));
    try {
      const { error } = await request(
        linked ? '/api/entities/arc-links' : '/api/entities/arc-links/unlink',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            name: detail?.canonical ?? name,
            qualifier: identityQualifier,
            arcId,
          }),
        }
      );
      if (staleRef.current) return;
      if (error) {
        showError(error);
        return;
      }
      setArcLinks((prev) =>
        linked ? [...new Set([...prev, arcId])] : prev.filter((id) => id !== arcId)
      );
    } finally {
      if (!staleRef.current) {
        setTogglingArcIds((prev) => {
          const next = new Set(prev);
          next.delete(arcId);
          return next;
        });
      }
    }
  }

  function cancelEditMiniSummary() {
    setEditingMiniSummary(false);
    setEditingMiniSummaryText('');
  }

  async function saveMiniSummary() {
    const text = editingMiniSummaryText.trim();
    if (text.length > 200) {
      showError(t('world.entity.miniSummary.maxLength', { count: formatNumber(200) }));
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
      showSuccess(t('world.entity.miniSummary.saved'));
    }
  }

  return (
    <>
      <Modal
        isOpen
        title={`${getEntityTypeLabel(type, t)}: ${formatEntityLabel(detail?.canonical ?? name, detail?.qualifier ?? qualifier)}`}
        className="max-w-xl"
        onClose={handleClose}
      >
        {loading ? (
          <div className="py-8 flex justify-center">
            <Loading size="md" />
          </div>
        ) : !detail ? (
          <p className="text-slate-400">{t('world.entity.loadError')}</p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-h)] mb-1">
                {t('world.entity.canonicalName')}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={canonical}
                  aria-label={t('world.entity.canonicalName')}
                  onChange={(e) => setCanonical(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-2 rounded bg-slate-900/50 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                  placeholder={t('world.entity.namePlaceholder')}
                />
                <button
                  type="button"
                  onClick={() => setCorrectionOpen(true)}
                  title={t('world.entity.correctKnowledgeTitle')}
                  className="text-xs px-3 py-2 rounded bg-[var(--accent)]/10 border border-[var(--accent)] text-[var(--accent)] font-semibold hover:bg-[var(--accent)]/20 transition whitespace-nowrap"
                >
                  {t('world.entity.correctKnowledgeButton')}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {t('world.entity.identityDescription', { type: getEntityTypeLabel(type, t) })}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-h)] mb-1">
                {t('world.entity.qualifier')}{' '}
                <span className="font-normal text-slate-500">{t('world.entity.optional')}</span>
              </label>
              <input
                type="text"
                value={qualifierValue}
                aria-label={t('world.entity.qualifier')}
                onChange={(e) => setQualifierValue(e.target.value)}
                className="w-full px-3 py-2 rounded bg-slate-900/50 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                placeholder={t('world.entity.qualifierPlaceholder')}
              />
              <p className="text-xs text-slate-500 mt-1">
                {t('world.entity.qualifierDescription')}{' '}
                <span className="text-slate-400">
                  {formatEntityLabel(
                    canonical.trim() || t('world.entity.namePlaceholder'),
                    qualifierValue.trim()
                  )}
                </span>
              </p>
            </div>

            {!loading && detail && (
              <div className="text-xs min-h-[1rem]">
                {autoSaveStatus === 'saving' && (
                  <span className="text-slate-400">{t('world.entity.autosave.saving')}</span>
                )}
                {autoSaveStatus === 'saved' && (
                  <span className="text-emerald-400">{t('world.entity.autosave.saved')}</span>
                )}
                {autoSaveStatus === 'error' && autoSaveError && (
                  <span className="text-[var(--danger)]">{autoSaveError}</span>
                )}
              </div>
            )}

            <div className="border-b border-[var(--border)]">
              <div
                className="flex gap-2"
                role="tablist"
                aria-label={t('world.entity.tabs.summary')}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'summary'}
                  onClick={() => setActiveTab('summary')}
                  className={`px-3 py-1.5 text-sm font-medium border-b-2 transition ${
                    activeTab === 'summary'
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-slate-400 hover:text-[var(--text-h)]'
                  }`}
                >
                  {t('world.entity.tabs.summary')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'aliases'}
                  onClick={() => setActiveTab('aliases')}
                  className={`px-3 py-1.5 text-sm font-medium border-b-2 transition ${
                    activeTab === 'aliases'
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-slate-400 hover:text-[var(--text-h)]'
                  }`}
                >
                  {t('world.entity.tabs.aliases')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'knowledge'}
                  onClick={() => setActiveTab('knowledge')}
                  className={`px-3 py-1.5 text-sm font-medium border-b-2 transition ${
                    activeTab === 'knowledge'
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-slate-400 hover:text-[var(--text-h)]'
                  }`}
                >
                  {t('world.entity.tabs.knowledge')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'arcs'}
                  onClick={() => setActiveTab('arcs')}
                  className={`px-3 py-1.5 text-sm font-medium border-b-2 transition ${
                    activeTab === 'arcs'
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-slate-400 hover:text-[var(--text-h)]'
                  }`}
                >
                  {t('world.entity.tabs.arcs')}
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
                      className="text-xs px-2 py-1 rounded bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold hover:brightness-110 transition disabled:opacity-50"
                    >
                      {generatingSummary
                        ? t('world.entity.summary.generating')
                        : summary
                          ? t('world.entity.summary.update')
                          : t('world.entity.summary.generate')}
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
                        {t('world.entity.summary.stale')}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 italic p-2 rounded border border-dashed border-[var(--border)] bg-slate-900/30">
                    {t('world.entity.summary.empty')}
                  </div>
                )}

                <div className="mt-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-[var(--text-h)]">
                      {t('world.entity.miniSummary.title')}
                    </p>
                    {!editingMiniSummary && (
                      <button
                        type="button"
                        onClick={startEditMiniSummary}
                        title={t('world.entity.miniSummary.editTitle')}
                        aria-label={t('world.entity.miniSummary.label')}
                        className="text-xs text-slate-500 hover:text-[var(--accent)] transition"
                      >
                        {t('world.entity.miniSummary.edit')}
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
                        aria-label={t('world.entity.miniSummary.label')}
                        className="w-full px-2 py-1 text-sm rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none resize-y"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={saveMiniSummary}
                          disabled={editingMiniSummaryText.trim().length > 200}
                          className="text-xs px-2 py-1 rounded bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold hover:brightness-110 transition disabled:opacity-50"
                        >
                          {t('world.entity.miniSummary.save')}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditMiniSummary}
                          className="text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition"
                        >
                          {t('shared.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : miniSummary ? (
                    <p className="text-sm text-slate-300 whitespace-pre-wrap">{miniSummary}</p>
                  ) : (
                    <p className="text-sm text-slate-500 italic">
                      {t('world.entity.miniSummary.empty')}
                    </p>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'aliases' && (
              <div>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {aliases.length === 0 ? (
                    <p className="text-slate-500 text-sm italic">
                      {t('world.entity.aliases.empty')}
                    </p>
                  ) : (
                    aliases.map((alias, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={alias}
                          aria-label={t('world.entity.aliases.newPlaceholder')}
                          onChange={(e) => updateAlias(index, e.target.value)}
                          className="flex-1 min-w-0 px-3 py-2 rounded bg-slate-900/50 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => removeAlias(index)}
                          title={t('world.entity.aliases.removeTitle')}
                          aria-label={t('world.entity.aliases.removeTitle')}
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
                    aria-label={t('world.entity.aliases.newPlaceholder')}
                    onChange={(e) => setNewAlias(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addAlias();
                      }
                    }}
                    placeholder={t('world.entity.aliases.newPlaceholder')}
                    className="flex-1 min-w-0 px-3 py-2 rounded bg-slate-900/50 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={addAlias}
                    disabled={!newAlias.trim()}
                    className="px-3 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition disabled:opacity-50"
                  >
                    {t('world.entity.aliases.add')}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'knowledge' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-[var(--text-h)]">
                    {t('world.entity.knowledge.title')}
                  </p>
                  <button
                    type="button"
                    onClick={handleReviewKnowledge}
                    disabled={reviewing || loading}
                    title={t('world.entity.knowledge.reviewTitle')}
                    aria-label={t('world.entity.knowledge.reviewTitle')}
                    className="text-xs px-2 py-1 rounded bg-[var(--accent)]/10 border border-[var(--accent)] text-[var(--accent)] font-semibold hover:bg-[var(--accent)]/20 transition disabled:opacity-50 whitespace-nowrap"
                  >
                    {reviewing
                      ? t('world.entity.knowledge.reviewing')
                      : t('world.entity.knowledge.review')}
                  </button>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {knowledge.length === 0 ? (
                    <p className="text-slate-500 text-sm italic">
                      {t('world.entity.knowledge.empty')}
                    </p>
                  ) : (
                    knowledge.map((entry) => {
                      const isDeleted = entry.status === 'deleted';
                      const validFromLabel =
                        entry.validFrom === null
                          ? t('world.entity.knowledge.beginning')
                          : formatNumber(entry.validFrom);
                      const lastValid = entry.validUntil !== null ? entry.validUntil - 1 : null;
                      const lastValidLabel = lastValid === null ? '' : formatNumber(lastValid);
                      const originTitle = entry.originTitle ? `: ${entry.originTitle}` : '';
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
                                aria-label={t('world.entity.knowledge.editTitle')}
                                onChange={(e) => setEditingKnowledgeTitle(e.target.value)}
                                placeholder={t('world.entity.knowledge.newTitle')}
                                className="w-full px-2 py-1 text-sm rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                              />
                              <textarea
                                value={editingKnowledgeContent}
                                aria-label={t('world.entity.knowledge.contentLabel')}
                                onChange={(e) => setEditingKnowledgeContent(e.target.value)}
                                rows={2}
                                className="w-full px-2 py-1 text-sm rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none resize-y"
                              />
                              <div className="flex items-center gap-2">
                                <label className="text-[10px] text-slate-500 whitespace-nowrap">
                                  {t('world.entity.knowledge.validUntil')}
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  value={editingKnowledgeValidUntil}
                                  aria-label={t('world.entity.knowledge.validUntil')}
                                  onChange={(e) => setEditingKnowledgeValidUntil(e.target.value)}
                                  placeholder={t('world.entity.knowledge.open')}
                                  className="w-24 px-2 py-1 text-sm rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => saveEditKnowledge(entry.id)}
                                  className="text-xs px-2 py-1 rounded bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold hover:brightness-110 transition"
                                >
                                  {t('world.entity.knowledge.save')}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditKnowledge}
                                  className="text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition"
                                >
                                  {t('shared.cancel')}
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
                                    {t('world.entity.knowledge.deleted')}
                                  </span>
                                )}
                                {entry.originType && (
                                  <span
                                    title={
                                      entry.originType === 'diary'
                                        ? t('world.entity.knowledge.sourceDiaryTitle', {
                                            title: originTitle,
                                          })
                                        : t('world.entity.knowledge.sourceSessionTitle', {
                                            title: originTitle,
                                          })
                                    }
                                    className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-medium whitespace-nowrap"
                                  >
                                    {t('world.entity.knowledge.source')}{' '}
                                    {entry.originType === 'diary'
                                      ? t('world.entity.knowledge.sourceDiary')
                                      : t('world.entity.knowledge.sourceSession')}
                                    {originTitle}
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
                                    return (
                                      <span
                                        title={
                                          entry.validUntil !== null
                                            ? t('world.entity.knowledge.validRangeTitle', {
                                                from: validFromLabel,
                                                to: lastValidLabel,
                                                until: formatNumber(entry.validUntil ?? 0),
                                              })
                                            : t('world.entity.knowledge.validFromTitle', {
                                                from: validFromLabel,
                                              })
                                        }
                                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${
                                          isOver
                                            ? 'bg-amber-500/10 text-amber-400'
                                            : 'bg-[var(--accent)]/10 text-[var(--accent)]'
                                        }`}
                                      >
                                        {entry.validUntil !== null
                                          ? t('world.entity.knowledge.validRange', {
                                              from: validFromLabel,
                                              to: lastValidLabel,
                                            })
                                          : t('world.entity.knowledge.validFrom', {
                                              from: validFromLabel,
                                            })}
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
                                  {t('world.entity.knowledge.reason')} {entry.statusReason}
                                </p>
                              )}
                              {!isDeleted && entry.validUntil !== null && entry.statusReason && (
                                <p className="text-xs text-slate-500 italic">
                                  {t('world.entity.knowledge.reason')} {entry.statusReason}
                                </p>
                              )}
                              {!isDeleted && (
                                <div className="flex gap-2 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => startEditKnowledge(entry)}
                                    title={t('world.entity.knowledge.editTitle')}
                                    aria-label={t('world.entity.knowledge.edit')}
                                    className="text-xs text-slate-500 hover:text-[var(--accent)] transition"
                                  >
                                    {t('world.entity.knowledge.edit')}
                                  </button>
                                  {entry.validUntil === null && currentGameDay != null && (
                                    <button
                                      type="button"
                                      onClick={() => handleEndKnowledge(entry.id)}
                                      title={t('world.entity.knowledge.endTitle', {
                                        day: formatNumber(currentGameDay),
                                      })}
                                      aria-label={t('world.entity.knowledge.endTitle', {
                                        day: formatNumber(currentGameDay),
                                      })}
                                      className="text-xs text-slate-500 hover:text-[var(--accent)] transition"
                                    >
                                      {t('world.entity.knowledge.end')}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteKnowledge(entry.id)}
                                    title={t('world.entity.knowledge.markInvalidTitle')}
                                    aria-label={t('world.entity.knowledge.markInvalidTitle')}
                                    className="text-xs text-slate-500 hover:text-[var(--danger)] transition"
                                  >
                                    {t('world.entity.knowledge.invalid')}
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
                    aria-label={t('world.entity.knowledge.newTitle')}
                    onChange={(e) => setNewKnowledgeTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAddKnowledge();
                      }
                    }}
                    placeholder={t('world.entity.knowledge.newTitle')}
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
                    placeholder={t('world.entity.knowledge.newContent')}
                    aria-label={t('world.entity.knowledge.newContent')}
                    className="w-full px-2 py-1 text-sm rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none resize-y"
                  />
                  {(currentGameDay ?? null) !== null && (
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-slate-500 whitespace-nowrap">
                        {t('world.entity.knowledge.validFromInput')}
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={newKnowledgeValidFrom}
                        aria-label={t('world.entity.knowledge.validFromInput')}
                        onChange={(e) => setNewKnowledgeValidFrom(e.target.value)}
                        placeholder={t('world.entity.knowledge.currently', {
                          day: formatNumber(currentGameDay ?? 0),
                        })}
                        className="w-24 px-2 py-1 text-sm rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                      />
                      <label className="text-[10px] text-slate-500 whitespace-nowrap">
                        {t('world.entity.knowledge.validUntilShort')}
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={newKnowledgeValidUntil}
                        aria-label={t('world.entity.knowledge.validUntilShort')}
                        onChange={(e) => setNewKnowledgeValidUntil(e.target.value)}
                        placeholder={t('world.entity.knowledge.open')}
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
                    {t('world.entity.knowledge.add')}
                  </button>
                </div>
              </div>
            )}
            {activeTab === 'arcs' && (
              <div>
                <p className="text-xs text-slate-500 mb-2">
                  {t('world.entity.arcs.description', { type: getEntityTypeLabel(type, t) })}
                </p>
                {storyArcs.length === 0 ? (
                  <p className="text-slate-500 text-sm italic">{t('world.entity.arcs.empty')}</p>
                ) : (
                  <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                    {storyArcs.map((arc) => {
                      const linked = arcLinks.includes(arc.id);
                      const toggling = togglingArcIds.has(arc.id);
                      return (
                        <label
                          key={arc.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded bg-slate-900/50 border border-[var(--border)] text-sm text-[var(--text-h)] transition ${
                            toggling ? 'opacity-60' : 'cursor-pointer hover:border-[var(--accent)]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={linked}
                            aria-label={arc.name}
                            disabled={toggling}
                            onChange={(e) => void toggleArcLink(arc.id, e.target.checked)}
                            className="accent-[var(--accent)]"
                          />
                          <ChapterStatusDot status={arc.status} />
                          <span className="flex-1 min-w-0 truncate">
                            {arc.chapterNumber !== null && (
                              <span className="chapter-caps mr-1.5 text-[9.5px] text-amber-200/60">
                                {t('world.entity.arcs.chapter', {
                                  number: formatNumber(arc.chapterNumber),
                                })}{' '}
                                ·
                              </span>
                            )}
                            <span className="chapter-serif">{arc.name}</span>
                            <span className="ml-2 text-xs text-slate-500">
                              {localizedArcStatus(arc.status, t)}
                              {arc.gameDayStart !== null
                                ? ` · ${
                                    arc.gameDayEnd !== null && arc.gameDayEnd !== arc.gameDayStart
                                      ? t('shell.chapterFilter.gameDayRange', {
                                          start: formatNumber(arc.gameDayStart),
                                          end: formatNumber(arc.gameDayEnd),
                                        })
                                      : t('shell.chapterFilter.gameDay', {
                                          day: formatNumber(arc.gameDayStart),
                                        })
                                  }`
                                : ''}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
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
