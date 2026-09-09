import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { APPS, isAppVisible } from '../lib/apps';
import type { VersionInfo } from '../../shared/types';

interface HomeProps {
  version: VersionInfo | null | undefined;
}

export function Home({ version }: HomeProps) {
  const { effectiveUser } = useAuth();

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
      <h1 className="text-5xl font-bold text-[var(--text-h)] mb-4">DnD Dashboard</h1>
      <p className="text-xl text-slate-400 mb-12">Wähle einen Bereich</p>
      {needsCharacter && (
        <div className="mb-12 w-full max-w-4xl bg-[var(--warning)]/10 border border-[var(--warning)]/40 rounded-xl px-4 py-3 text-sm text-[var(--text-h)]">
          Dir ist noch kein Charakter zugewiesen – daher ist das Tagebuch ausgeblendet. Bitte wende
          dich an einen Admin.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl">
        {homeApps.map((app) => (
          <Link
            key={app.id}
            to={app.path}
            className="group block bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 hover:border-[var(--accent)] transition"
          >
            <h2 className="text-2xl font-semibold text-[var(--text-h)] group-hover:text-[var(--accent)] transition">
              {app.label}
            </h2>
            <p className="text-slate-400 mt-2">{app.description ?? ''}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
