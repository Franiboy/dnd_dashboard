import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { Loading } from '../components/Loading';
import { PasswordInput } from '../components/PasswordInput';
import { useI18n } from '../hooks/useI18n';
import { localizeServerMessage } from '../i18n/serverMessages';

interface AdminLoginProps {
  onLogin: (username: string, password: string) => Promise<boolean>;
  error: string | null;
}

export function AdminLogin({ onLogin, error }: AdminLoginProps) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const visibleError = error ? localizeServerMessage(error, t) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const ok = await onLogin(username.trim(), password);
    setLoading(false);
    if (ok) navigate('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 shadow-xl"
      >
        <div className="mb-5 flex justify-center">
          <LanguageSwitcher id="admin-login-language" />
        </div>
        <h1 className="text-3xl font-bold text-[var(--text-h)] mb-2 text-center">
          {t('auth.adminLogin')}
        </h1>
        <p className="text-center mb-6 text-slate-400">{t('auth.adminOnly')}</p>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t('auth.username')}
          aria-label={t('auth.username')}
          className="w-full px-4 py-3 rounded-lg bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] mb-4"
        />
        <PasswordInput
          value={password}
          onChange={setPassword}
          placeholder={t('auth.password')}
          showLabel={t('auth.showPassword')}
          hideLabel={t('auth.hidePassword')}
          className="mb-4"
        />
        {visibleError && <p className="text-[var(--danger)] text-sm mb-4">{visibleError}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)] font-semibold hover:brightness-110 transition disabled:opacity-50"
        >
          {loading ? <Loading text="" size="sm" className="justify-center" /> : t('auth.login')}
        </button>
      </form>
    </div>
  );
}
