import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

interface AuthCallbackProps {
  onCallback: (code: string) => Promise<{ ok: boolean; message?: string }>;
}

export function AuthCallback({ onCallback }: AuthCallbackProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('Verarbeite Discord Login...');

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setStatus('Kein Code von Discord erhalten.');
      return;
    }

    onCallback(code).then((result) => {
      if (result.ok) {
        navigate('/');
      } else {
        setStatus(result.message || 'Login fehlgeschlagen. Bitte warte auf Admin-Freigabe.');
      }
    });
  }, [searchParams, navigate, onCallback]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 text-slate-400">
      {status}
    </div>
  );
}
