import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../hooks/useI18n';
import { APPS, getAppDescription, getAppLabel, isAppVisible } from '../lib/apps';
import type { VersionInfo } from '../../shared/types';

interface HomeProps {
  version: VersionInfo | null | undefined;
}

export function Home({ version }: HomeProps) {
  const { effectiveUser } = useAuth();
  const { t } = useI18n();

  // Players without an admin-assigned character have the diary hidden; explain
  // why so the missing tile is not confusing.
  const needsCharacter =
    !!effectiveUser &&
    !effectiveUser.isAdmin &&
    effectiveUser.role === 'player' &&
    !effectiveUser.activePerson;

  const homeApps = APPS.filter(
    (app) =>
      app.id !== 'dashboard' &&
      app.id !== 'admin' &&
      effectiveUser &&
      isAppVisible(app, effectiveUser, version)
  );

  return (
    <div className="min-h-full p-6 flex flex-col items-center justify-center">
      <h1 className="text-4xl sm:text-5xl font-bold text-[var(--text-h)] mb-4">
        {t('shell.home.title')}
      </h1>
      <p className="text-xl text-slate-400 mb-12">{t('shell.home.subtitle')}</p>
      {needsCharacter && (
        <div className="mb-12 w-full max-w-4xl bg-[var(--warning)]/10 border border-[var(--warning)]/40 rounded-xl px-4 py-3 text-sm text-[var(--text-h)]">
          {t('shell.home.characterRequired')}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl">
        {homeApps.length === 0 ? (
          <p className="w-full max-w-4xl text-center text-slate-400">{t('shell.home.noApps')}</p>
        ) : (
          homeApps.map((app) => {
            const label = getAppLabel(app, t);
            const description = getAppDescription(app, t);
            return (
              <Link
                key={app.id}
                to={app.path}
                className="group block bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 sm:p-8 hover:border-[var(--accent)] transition"
              >
                <h2 className="text-2xl font-semibold text-[var(--text-h)] group-hover:text-[var(--accent)] transition">
                  {label}
                </h2>
                {description && <p className="text-slate-400 mt-2">{description}</p>}
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
