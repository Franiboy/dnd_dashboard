import { useId, type ReactNode } from 'react';
import { useI18n } from '../hooks/useI18n';

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'accent' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  variant = 'accent',
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const resolvedConfirmLabel = confirmLabel ?? t('shared.confirm');
  const resolvedCancelLabel = cancelLabel ?? t('shared.cancel');
  const confirmClasses =
    variant === 'danger'
      ? 'bg-[var(--danger)] text-white hover:bg-red-400'
      : 'bg-[var(--accent)] text-[var(--accent-contrast)] hover:brightness-110';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={loading || undefined}
        className="flex min-h-0 max-h-full min-w-0 flex-col overflow-y-auto bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4 sm:p-6 max-w-sm w-full shadow-2xl"
      >
        <h3
          id={titleId}
          className="shrink-0 wrap-anywhere text-xl font-semibold text-[var(--text-h)] mb-2"
        >
          {title}
        </h3>
        <div className="min-h-0 overflow-y-auto wrap-anywhere text-slate-300 mb-6">{children}</div>
        <div className="flex shrink-0 flex-wrap justify-end gap-3 [&>button]:min-h-11">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition disabled:opacity-50"
          >
            {resolvedCancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded font-semibold transition ${confirmClasses} disabled:opacity-50`}
          >
            {loading ? t('shared.waiting') : resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
