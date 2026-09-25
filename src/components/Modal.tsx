import { useId, type ReactNode } from 'react';
import { useI18n } from '../hooks/useI18n';

interface ModalProps {
  isOpen: boolean;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  /** Accessible label for the close button; defaults to the current language. */
  closeLabel?: string;
  className?: string;
  contentClassName?: string;
}

export function Modal({
  isOpen,
  title,
  children,
  actions,
  onClose,
  closeLabel,
  className = '',
  contentClassName = '',
}: ModalProps) {
  const { t } = useI18n();
  const titleId = useId();
  const resolvedCloseLabel = closeLabel ?? t('shared.close');

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex min-h-0 max-h-full min-w-0 flex-col overflow-y-auto bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4 sm:p-6 max-w-2xl w-full shadow-2xl ${className}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 mb-4">
          <h3
            id={titleId}
            className="min-w-0 wrap-anywhere text-xl font-semibold text-[var(--text-h)]"
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex size-11 shrink-0 items-center justify-center text-slate-400 hover:text-[var(--text-h)] text-2xl leading-none"
            aria-label={resolvedCloseLabel}
          >
            ×
          </button>
        </div>
        <div
          className={`min-h-0 min-w-0 overflow-y-auto wrap-anywhere text-slate-300 ${contentClassName}`}
        >
          {children}
        </div>
        {actions && (
          <div className="mt-6 flex shrink-0 flex-wrap justify-end gap-3 [&>button]:min-h-11">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
