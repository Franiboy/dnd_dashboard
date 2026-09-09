import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loading } from '../components/Loading';

interface AuthCallbackProps {
  onCallback: (
    code: string,
    state: string
  ) => Promise<{ ok: boolean; pending?: boolean; message?: string }>;
  onCheckApproved?: () => Promise<boolean>;
}

const PROCESSED_KEY = 'discord_code_processed';

export function AuthCallback({ onCallback, onCheckApproved }: AuthCallbackProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('Verarbeite Discord Login...');
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    if (!code || !state) {
      // Status is synced from the URL (external system) on mount.
      // oxlint-disable-next-line react/set-state-in-effect
      setStatus('Kein Code oder State von Discord erhalten.');
      return;
    }

    // Avoid double-processing the same code (e.g. React Strict Mode remount)
    const processedCode = sessionStorage.getItem(PROCESSED_KEY);
    if (processedCode === code) {
      setStatus('Code wurde bereits verarbeitet. Bitte warte auf Freigabe.');
      setWaiting(true);
      return;
    }
    sessionStorage.setItem(PROCESSED_KEY, code);

    onCallback(code, state).then((result) => {
      if (result.ok) {
        navigate('/');
      } else {
        setStatus(result.message || 'Login fehlgeschlagen.');
        setWaiting(result.pending === true);
      }
    });
  }, [searchParams, navigate, onCallback]);

  useEffect(() => {
    if (!waiting || !onCheckApproved) return;

    const check = async () => {
      const approved = await onCheckApproved();
      if (approved) {
        navigate('/');
      }
    };

    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [waiting, navigate, onCheckApproved]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 shadow-xl text-center">
        {waiting ? (
          <>
            <Loading size="lg" className="justify-center mb-4" />
            <h2 className="text-xl font-semibold text-[var(--text-h)] mb-2">Warte auf Freigabe</h2>
            <p className="text-slate-400 mb-4">{status}</p>
            <p className="text-sm text-slate-500">
              Diese Seite prüft automatisch alle 5 Sekunden, ob ein Admin dich freigegeben hat. Du
              musst nichts weiter tun.
            </p>
          </>
        ) : (
          <>
            <Loading size="lg" className="justify-center mb-4" />
            <p className="text-slate-400">{status}</p>
          </>
        )}
      </div>
    </div>
  );
}
