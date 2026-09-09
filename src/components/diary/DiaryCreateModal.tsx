import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useStoryArcs } from '../../hooks/useStoryArcs';
import { Loading } from '../Loading';
import { Modal } from '../Modal';
import { QuillWithEntityMention } from '../QuillWithEntityMention';
import { stripHtml, quillFormats, quillModules } from '../quillConfig';
import type { CampaignDay, DiaryEntry } from '../../../shared/types';

interface DiaryCreateModalProps {
  isOpen: boolean;
  /** Existing entries, used for duplicate game-day validation. */
  entries: DiaryEntry[];
  working: boolean;
  aiOperation: boolean;
  aiStatus: string | null;
  onClose: () => void;
  onCreated: (entry: DiaryEntry) => void;
  onWorkingChange: (working: boolean) => void;
  onAiStart: (status: string) => void;
  onAiEnd: () => void;
  /** Resolves once the AI status SSE stream is connected. */
  sseReady: Promise<void>;
  mappings: Parameters<typeof QuillWithEntityMention>[0]['mappings'];
}

interface DiaryFormData {
  content: string;
}

/** Modal for manually creating a diary entry on a campaign game day. */
export function DiaryCreateModal({
  isOpen,
  entries,
  working,
  aiOperation,
  aiStatus,
  onClose,
  onCreated,
  onWorkingChange,
  onAiStart,
  onAiEnd,
  sseReady,
  mappings,
}: DiaryCreateModalProps) {
  const { request } = useApi();
  const { arcs: storyArcs, activeArcId } = useStoryArcs();
  const [form, setForm] = useState<DiaryFormData>({ content: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [campaignDays, setCampaignDays] = useState<CampaignDay[]>([]);
  const [nextGameDay, setNextGameDay] = useState<number | null>(null);
  const [createDayValue, setCreateDayValue] = useState<number | ''>('');
  const [customDayValue, setCustomDayValue] = useState<number | ''>('');
  const [skipMode, setSkipMode] = useState(false);
  const [currentGameDay, setCurrentGameDay] = useState<number | null | undefined>(undefined);
  const [createArcValue, setCreateArcValue] = useState<number | ''>('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      const { data } = await request<{
        days: CampaignDay[];
        currentGameDay: number | null;
        nextGameDay: number;
      }>('/api/campaign/days');
      if (data && !cancelled) {
        setCampaignDays(data.days);
        setNextGameDay(data.nextGameDay);
        setCurrentGameDay(data.currentGameDay);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, request]);

  function resetForm() {
    setForm({ content: '' });
    setFormError(null);
    setCreateDayValue('');
    setCustomDayValue('');
    setSkipMode(false);
    setCurrentGameDay(undefined);
    setCreateArcValue(activeArcId ?? '');
  }

  function closeModal() {
    if (working) return;
    onClose();
    resetForm();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const plainText = stripHtml(form.content).trim();
    const selectedDay = skipMode ? customDayValue : createDayValue;
    if (!plainText || selectedDay === '' || Number(selectedDay) <= 0) {
      setFormError('Wähle einen Spieltag und erfülle den Inhalt');
      return;
    }

    const gameDay = Number(selectedDay);
    if (!Number.isInteger(gameDay) || gameDay <= 0) {
      setFormError('Spieltag muss eine positive ganze Zahl sein');
      return;
    }
    if (skipMode && currentGameDay === undefined) {
      setFormError('Der aktuelle Spieltag wird noch geladen');
      return;
    }
    if (
      skipMode &&
      currentGameDay !== null &&
      currentGameDay !== undefined &&
      gameDay <= currentGameDay
    ) {
      setFormError(
        `Überspringen nur nach dem höchsten bekannten Spieltag (Tag ${currentGameDay}) möglich`
      );
      return;
    }
    if (entries.some((entry) => entry.gameDay === gameDay)) {
      setFormError(`Spieltag ${gameDay} existiert bereits`);
      return;
    }

    const payload = {
      content: form.content,
      gameDay,
      ...(createArcValue !== '' ? { arcId: Number(createArcValue) } : {}),
    };

    onAiStart('Eintrag wird erstellt und analysiert...');
    await Promise.race([sseReady, new Promise<void>((resolve) => setTimeout(resolve, 500))]);
    onWorkingChange(true);

    let res;
    try {
      res = await request<{ entry: DiaryEntry }>('/api/diary/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } finally {
      onWorkingChange(false);
      onAiEnd();
    }

    if (res.error) {
      setFormError(res.error);
      return;
    }

    if (res.data) {
      onCreated(res.data.entry);
    }
    closeModal();
  }

  const modalActions = (
    <>
      <button
        type="button"
        onClick={closeModal}
        disabled={working}
        className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition disabled:opacity-50"
      >
        Abbrechen
      </button>
      <button
        type="submit"
        form="diary-form"
        disabled={
          working ||
          !stripHtml(form.content).trim() ||
          (skipMode
            ? customDayValue === '' || currentGameDay === undefined
            : !(createDayValue !== '' && Number(createDayValue) > 0))
        }
        className="px-4 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:brightness-110 transition disabled:opacity-50"
      >
        {working ? <Loading text="" size="sm" /> : 'Erstellen'}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      title="Neuer Eintrag"
      onClose={closeModal}
      actions={modalActions}
      className="h-[85vh] flex flex-col max-w-5xl"
      contentClassName="flex-1 min-h-0 overflow-hidden flex flex-col"
    >
      {formError && (
        <div className="mb-4 p-3 rounded bg-red-900/30 text-red-400 border border-red-700">
          {formError}
        </div>
      )}
      <form
        id="diary-form"
        onSubmit={handleSubmit}
        className="flex-1 min-h-0 flex flex-col space-y-4 px-1"
      >
        <div>
          <label className="block text-sm text-slate-400 mb-1">Spieltag</label>
          <select
            value={skipMode ? '__skip__' : createDayValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__skip__') {
                setSkipMode(true);
                setCreateDayValue('');
                setCustomDayValue('');
              } else {
                setSkipMode(false);
                setCreateDayValue(v === '' ? '' : Number(v));
                setCustomDayValue('');
              }
            }}
            disabled={working}
            required={!skipMode}
            className="w-full px-3 py-2 rounded border border-[var(--border)] bg-slate-900 text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            {' '}
            <option value="">Spieltag wählen…</option>
            <option value="__skip__">Tage überspringen…</option>
            {nextGameDay !== null && (
              <option value={nextGameDay}>Spieltag {nextGameDay} – nächster Tag</option>
            )}
            {campaignDays
              .filter((d) => !entries.some((entry) => entry.gameDay === d.day))
              .sort((a, b) => b.day - a.day)
              .filter((d) => d.day !== nextGameDay)
              .map((d) => (
                <option key={d.day} value={d.day}>
                  Spieltag {d.day}
                </option>
              ))}
          </select>
          {skipMode && (
            <div className="mt-3">
              <label className="block text-xs text-slate-400 mb-1">Tage überspringen</label>
              <input
                type="number"
                min={(currentGameDay ?? 0) + 1}
                step={1}
                placeholder={
                  currentGameDay !== null && currentGameDay !== undefined
                    ? `z. B. ${currentGameDay + 7}`
                    : 'z. B. 50'
                }
                value={customDayValue}
                onChange={(e) => {
                  const v = e.target.value;
                  setCustomDayValue(v === '' ? '' : Number(v));
                }}
                disabled={working}
                required={skipMode}
                className="w-full px-3 py-2 rounded border border-[var(--border)] bg-slate-900 text-[var(--text-h)] placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              <p className="mt-1 text-xs text-slate-500">
                Legt den Tag direkt an – nur Ziffern, größer als der höchste bekannte Spieltag
                {currentGameDay !== null && currentGameDay !== undefined
                  ? ` (Tag ${currentGameDay})`
                  : ''}
                .
              </p>
            </div>
          )}
        </div>
        {storyArcs.length > 0 && (
          <div>
            <label className="block text-sm text-slate-400 mb-1">Story Arc</label>
            <select
              value={createArcValue}
              onChange={(e) =>
                setCreateArcValue(e.target.value === '' ? '' : Number(e.target.value))
              }
              disabled={working}
              className="w-full px-3 py-2 rounded border border-[var(--border)] bg-slate-900 text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              {activeArcId === null && <option value="">Ohne Arc</option>}
              {storyArcs.map((arc) => (
                <option key={arc.id} value={arc.id}>
                  {arc.name}
                  {arc.status === 'active' ? ' (aktiv)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex-1 min-h-0 flex flex-col">
          <label className="block text-sm text-slate-400 mb-1">Inhalt</label>
          <QuillWithEntityMention
            theme="snow"
            mappings={mappings}
            value={form.content}
            onChange={(value) => setForm((prev) => ({ ...prev, content: value }))}
            modules={quillModules}
            formats={quillFormats}
            readOnly={working}
            className="diary-editor bg-slate-900 text-[var(--text-h)] rounded border border-[var(--border)] flex-1 min-h-0"
          />
        </div>
      </form>

      {aiOperation && aiStatus && (
        <div className="mt-4">
          <Loading size="sm" text={aiStatus} />
        </div>
      )}
    </Modal>
  );
}
