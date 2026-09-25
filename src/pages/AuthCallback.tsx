import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { useI18n } from '../hooks/useI18n';
import {
  getServerMessageKey,
  getServerMessageParams,
  localizeServerMessage,
  type ServerMessageLike,
} from '../i18n/serverMessages';
import type { ServerMessageParams } from '../../shared/types';
import type { TranslationKey } from '../i18n/messages';
import type { AuthCallbackResult } from '../hooks/useAuth';

interface AuthCallbackProps {
  onCallback: (code: string, state: string) => Promise<AuthCallbackResult>;
  onCheckApproved?: () => Promise<boolean>;
}

type CallbackStatus =
  | { kind: 'key'; key: TranslationKey; params?: ServerMessageParams }
  | { kind: 'message'; message: string };

const PROCESSED_KEY = 'discord_code_processed';

function statusFromResult(result: AuthCallbackResult): CallbackStatus {
  const payload: ServerMessageLike = {
    message: result.message ?? result.error,
    messageKey: result.messageKey,
    errorCode: result.errorCode,
    params: result.params,
  };
  const key = getServerMessageKey(payload);
  if (key) return { kind: 'key', key, params: getServerMessageParams(payload) };
  if (result.message) return { kind: 'message', message: result.message };
  if (result.error) return { kind: 'message', message: result.error };
  return { kind: 'key', key: 'auth.loginFailed' };
}

export function AuthCallback({ onCallback, onCheckApproved }: AuthCallbackProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [status, setStatus] = useState<CallbackStatus>({
    kind: 'key',
    key: 'auth.callbackProcessing',
  });
  const [waiting, setWaiting] = useState(false);
  const processedIdentityRef = useRef<string | null>(null);
  const onCallbackRef = useRef(onCallback);
  useEffect(() => {
    onCallbackRef.current = onCallback;
  }, [onCallback]);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const callbackIdentity = code && state ? `${code}\u0000${state}` : null;

  useEffect(() => {
    if (!code || !state) {
      // Status is synced from the URL (external system) on mount.
      // oxlint-disable-next-line react/set-state-in-effect
      setStatus({ kind: 'key', key: 'auth.noCodeOrState' });
      // oxlint-disable-next-line react/set-state-in-effect
      setWaiting(false);
      return;
    }

    if (processedIdentityRef.current === callbackIdentity) return;

    // Avoid double-processing the same code (e.g. React Strict Mode remount).
    const processedCode = sessionStorage.getItem(PROCESSED_KEY);
    if (processedCode === code) {
      processedIdentityRef.current = callbackIdentity;
      // oxlint-disable-next-line react/set-state-in-effect
      setStatus({ kind: 'key', key: 'auth.codeAlreadyProcessed' });
      // oxlint-disable-next-line react/set-state-in-effect
      setWaiting(true);
      return;
    }
    processedIdentityRef.current = callbackIdentity;
    sessionStorage.setItem(PROCESSED_KEY, code);
    // oxlint-disable-next-line react/set-state-in-effect
    setStatus({ kind: 'key', key: 'auth.callbackProcessing' });
    // oxlint-disable-next-line react/set-state-in-effect
    setWaiting(false);

    void onCallbackRef
      .current(code, state)
      .then((result) => {
        if (result.ok) {
          navigate('/');
        } else {
          setStatus(statusFromResult(result));
          setWaiting(result.pending === true);
        }
      })
      .catch(() => {
        setStatus({ kind: 'key', key: 'auth.loginFailed' });
        setWaiting(false);
      });
  }, [callbackIdentity, code, navigate, state]);

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

  const statusMessage =
    status.kind === 'key'
      ? (localizeServerMessage({ messageKey: status.key, params: status.params }, t, {
          fallbackKey: status.key,
          fallback: t(status.key, status.params),
        }) ?? t(status.key, status.params))
      : status.message;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 shadow-xl text-center">
        {waiting ? (
          <>
            <Loading size="lg" className="justify-center mb-4" />
            <h2 className="text-xl font-semibold text-[var(--text-h)] mb-2">
              {t('auth.waitForApproval')}
            </h2>
            <p className="text-slate-400 mb-4">{statusMessage}</p>
            <p className="text-sm text-slate-500">{t('auth.approvalDescription')}</p>
          </>
        ) : (
          <>
            <Loading size="lg" className="justify-center mb-4" />
            <p className="text-slate-400">{statusMessage}</p>
          </>
        )}
      </div>
    </div>
  );
}
