import { useEffect } from 'react';
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
        <div className="w-12 h-12 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        {user.avatarUrl && <img src={user.avatarUrl} alt="" className="w-16 h-16 rounded-full mx-auto mb-4" />}
        <h2 className="text-xl font-semibold text-[var(--text-h)] mb-2">Warte auf Freigabe</h2>
        <p className="text-slate-400 mb-4">{message}</p>
        <p className="text-sm text-slate-500 mb-4">
          Diese Seite prüft automatisch alle 5 Sekunden, ob ein Admin dich freigegeben hat.
        </p>
        <button onClick={onLogout} className="text-slate-400 hover:text-[var(--text-h)] underline">
          Logout
        </button>
      </div>
    </div>
  );
}
