import { EntityRichText } from '../EntityRichText';
import { Button } from '../Button';
import type { DiaryEntry } from '../../../shared/types';

/** Mapping rows as accepted by EntityRichText (same shape as useEntityMappings). */
type EntityMappings = Parameters<typeof EntityRichText>[0]['mappings'];

interface DiarySummaryPanelProps {
  entry: DiaryEntry;
  mappings: EntityMappings;
  working: boolean;
  /** AI summary generation is currently running for this entry. */
  processing: boolean;
  /** Inline summary edit mode is active. */
  editing: boolean;
  editText: string;
  onEditText: (text: string) => void;
  onGenerate: () => void;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}

/** Summary box of a diary entry with generate/edit affordances. */
export function DiarySummaryPanel({
  entry,
  mappings,
  working,
  processing,
  editing,
  editText,
  onEditText,
  onGenerate,
  onStartEdit,
  onSave,
  onCancel,
}: DiarySummaryPanelProps) {
  return (
    <div
      className={`mb-3 p-3 rounded-lg border ${entry.aiDirty ? 'bg-amber-900/20 border-amber-500/30' : 'bg-[var(--accent)]/10 border-[var(--accent)]/20'}`}
    >
      <div className="flex items-center justify-between mb-1">
        <p
          className={`text-sm font-semibold ${entry.aiDirty ? 'text-amber-500' : 'text-[var(--accent)]'}`}
        >
          Zusammenfassung
        </p>
        {!editing && (
          <div className="flex items-center gap-2">
            {entry.aiDirty || !entry.summary ? (
              <button
                type="button"
                title="Zusammenfassung aktualisieren"
                onClick={onGenerate}
                disabled={working || processing}
                className="text-xs px-2 py-1 rounded bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold hover:brightness-110 transition disabled:opacity-50"
              >
                {processing ? 'Wird generiert...' : entry.summary ? 'Aktualisieren' : 'Generieren'}
              </button>
            ) : (
              <button
                type="button"
                title="Zusammenfassung neu generieren"
                onClick={onGenerate}
                disabled={working}
                className="text-[var(--accent)] hover:text-[var(--accent-dim)] transition disabled:opacity-50"
              >
                {processing ? (
                  <svg
                    className="animate-spin"
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
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : (
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
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    <path d="M21 4v6h-6" />
                  </svg>
                )}
              </button>
            )}
            <button
              type="button"
              title="Zusammenfassung bearbeiten"
              onClick={onStartEdit}
              disabled={working}
              className="text-[var(--accent)] hover:text-[var(--accent-dim)] transition disabled:opacity-50"
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
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={editText}
            onChange={(e) => onEditText(e.target.value)}
            rows={3}
            maxLength={500}
            disabled={working}
            className="w-full px-3 py-2 rounded border border-[var(--border)] bg-slate-900 text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-y"
          />
          <div className="flex gap-2">
            <Button variant="accent" onClick={onSave} disabled={working}>
              Speichern
            </Button>
            <Button variant="ghost" onClick={onCancel} disabled={working}>
              Abbrechen
            </Button>
          </div>
        </div>
      ) : entry.summary ? (
        <div className="space-y-1">
          <p className="text-slate-300 text-sm whitespace-pre-wrap">
            <EntityRichText content={entry.summary} mappings={mappings} isHtml={false} />
          </p>
          {entry.aiDirty && (
            <p className="text-xs text-amber-500 italic">
              Zusammenfassung ist veraltet und sollte aktualisiert werden.
            </p>
          )}
        </div>
      ) : (
        <p className="text-slate-500 text-sm italic">Noch keine Zusammenfassung vorhanden.</p>
      )}
    </div>
  );
}
