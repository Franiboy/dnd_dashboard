import { useEffect } from 'react';
import { Loading } from './Loading';
import type { SafeUser } from '../../shared/types';

interface PendingApprovalProps {
  user: Pick<SafeUser, 'displayName' | 'avatarUrl'>;
  onCheckApproved: () => Promise<boolean>;
  onLogout: () => void;
}

export function PendingApproval({ user, onCheckApproved, onLogout }: PendingApprovalProps) {
  const message = 'Dein Account wurde noch nicht freigegeben.';

  useEffect(() => {
    const check = async () => {
      const approved = await onCheckApproved();
      if (approved) {
        window.location.href = '/';
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [onCheckApproved]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 shadow-xl text-center">
        <Loading size="lg" className="justify-center mb-4" />
        {user.avatarUrl && (
          <img src={user.avatarUrl} alt="" className="w-16 h-16 rounded-full mx-auto mb-4" />
        )}
        <h2 className="text-xl font-semibold text-[var(--text-h)] mb-2">Warte auf Freigabe</h2>
        <p className="text-slate-400 mb-4">{message}</p>
        <p className="text-sm text-slate-500 mb-4">
          Diese Seite prüft automatisch alle 5 Sekunden, ob ein Admin dich freigegeben hat.
        </p>
        <button
          onClick={onLogout}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--danger)]/20 text-[var(--danger)] hover:bg-[var(--danger)]/30 transition-colors"
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
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Logout
        </button>
      </div>
    </div>
  );
}
