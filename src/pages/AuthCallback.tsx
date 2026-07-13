import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

interface AuthCallbackProps {
  onCallback: (code: string) => Promise<{ ok: boolean; message?: string }>;
  onCheckApproved?: () => Promise<boolean>;
}

export function AuthCallback({ onCallback, onCheckApproved }: AuthCallbackProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('Verarbeite Discord Login...');
  const [waiting, setWaiting] = useState(false);
  const processedRef = useRef(false);

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setStatus('Kein Code von Discord erhalten.');
      return;
    }
    if (processedRef.current) return;
    processedRef.current = true;

    onCallback(code).then((result) => {
      if (result.ok) {
        navigate('/');
      } else {
        setStatus(result.message || 'Login fehlgeschlagen. Bitte warte auf Admin-Freigabe.');
        setWaiting(true);
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
            <div className="w-12 h-12 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-[var(--text-h)] mb-2">Warte auf Freigabe</h2>
            <p className="text-slate-400 mb-4">{status}</p>
            <p className="text-sm text-slate-500">
              Diese Seite prüft automatisch alle 5 Sekunden, ob ein Admin dich freigegeben hat. Du musst nichts weiter tun.
            </p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-400">{status}</p>
          </>
        )}
      </div>
    </div>
  );
}
