import type { ReactNode } from 'react';

interface ModalProps {
  isOpen: boolean;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  className?: string;
  contentClassName?: string;
}

export function Modal({ isOpen, title, children, actions, onClose, className = '', contentClassName = '' }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className={`bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 max-w-2xl w-full shadow-2xl ${className}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-[var(--text-h)]">{title}</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-[var(--text-h)] text-2xl leading-none"
            aria-label="Schließen"
          >
            ×
          </button>
        </div>
        <div className={`text-slate-300 ${contentClassName}`}>{children}</div>
        {actions && <div className="mt-6 flex justify-end gap-3">{actions}</div>}
      </div>
    </div>
  );
}
