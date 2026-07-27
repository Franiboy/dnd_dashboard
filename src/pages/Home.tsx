import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useApi } from '../hooks/useApi';
import { APPS } from '../lib/apps';
import type { VersionInfo } from '../../shared/types';

export function Home() {
  const { user } = useAuth();
  const { request } = useApi();
  const [version, setVersion] = useState<VersionInfo | null>(null);

  useEffect(() => {
    request<VersionInfo>('/api/version', {}, false).then(({ data }) => {
      if (data) setVersion(data);
    });
  }, [request]);

  const isAppVisible = (id: string) => {
    if (user?.disabledApps.includes(id)) return false;
    if (id === 'recordings') return user?.isAdmin && !!version?.recordingEnabled;
    return true;
  };

  const homeAppIds = ['notes', 'world', 'bingo', 'recordings'];
  const homeApps = APPS.filter((app) => homeAppIds.includes(app.id) && isAppVisible(app.id));

  const appDescriptions: Record<string, string> = {
    notes: 'Persönliche Notizen und Tagebucheinträge pro Spieler hinterlegen und mit der KI überarbeiten lassen.',
    world: 'Übersicht aller bekannten Personen, Organisationen und Orte.',
    bingo: 'Aufgaben sammeln, Bingo-Runde starten und gegeneinander spielen.',
    recordings: 'Discord-Sessions aufnehmen, transkribieren und als Text einsehen.',
  };

  return (
    <div className="min-h-full p-6 flex flex-col items-center justify-center">
      <h1 className="text-5xl font-bold text-[var(--text-h)] mb-4">DnD Dashboard</h1>
      <p className="text-xl text-slate-400 mb-12">Wähle einen Bereich</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl">
        {homeApps.map((app) => (
          <Link
            key={app.id}
            to={app.path}
            className="group block bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 hover:border-[var(--accent)] transition"
          >
            <h2 className="text-2xl font-semibold text-[var(--text-h)] group-hover:text-[var(--accent)] transition">{app.label}</h2>
            <p className="text-slate-400 mt-2">{appDescriptions[app.id] ?? ''}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
