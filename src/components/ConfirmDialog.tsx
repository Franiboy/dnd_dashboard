import type { ReactNode } from 'react';

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
  confirmLabel = 'Bestätigen',
  cancelLabel = 'Abbrechen',
  variant = 'accent',
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmClasses =
    variant === 'danger'
      ? 'bg-[var(--danger)] text-white hover:bg-red-400'
      : 'bg-[var(--accent)] text-slate-900 hover:bg-green-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <h3 className="text-xl font-semibold text-[var(--text-h)] mb-2">{title}</h3>
        <div className="text-slate-300 mb-6">{children}</div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded font-semibold transition ${confirmClasses} disabled:opacity-50`}
          >
            {loading ? 'Bitte warten...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
