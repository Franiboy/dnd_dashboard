import { useState, type ReactNode } from 'react';
import { BackButton } from './BackButton';
import { ConfirmDialog } from './ConfirmDialog';

interface DashboardHeaderProps {
  title: string;
  onReset?: () => void;
  resetLabel?: string;
  resetConfirmTitle?: string;
  resetConfirmMessage?: ReactNode;
  children?: ReactNode;
}

const DEFAULT_RESET_TITLE = 'UI-Layout zurücksetzen?';
const DEFAULT_RESET_MESSAGE = (
  <p>Das gespeicherte Dashboard-Layout wird auf das Standard-Layout zurückgesetzt.</p>
);

export function DashboardHeader({
  title,
  onReset,
  resetLabel = 'UI zurücksetzen',
  resetConfirmTitle = DEFAULT_RESET_TITLE,
  resetConfirmMessage = DEFAULT_RESET_MESSAGE,
  children,
}: DashboardHeaderProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold text-[var(--text-h)]">{title}</h1>

        <div className="flex items-center gap-3">
          {children}
          {onReset && (
            <button
              onClick={() => setConfirmOpen(true)}
              className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition"
            >
              {resetLabel}
            </button>
          )}
          <BackButton />
        </div>
      </div>

      {confirmOpen && onReset && (
        <ConfirmDialog
          title={resetConfirmTitle}
          confirmLabel="Zurücksetzen"
          variant="danger"
          onConfirm={() => {
            onReset();
            setConfirmOpen(false);
          }}
          onCancel={() => setConfirmOpen(false)}
        >
          {resetConfirmMessage}
        </ConfirmDialog>
      )}
    </>
  );
}
