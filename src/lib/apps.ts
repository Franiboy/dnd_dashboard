import type { SafeUser, VersionInfo } from '../../shared/types';

export interface AppMeta {
  id: string;
  label: string;
  path: string;
  /** Short description shown on the home dashboard. */
  description?: string;
  disableable?: boolean;
  adminOnly?: boolean;
  /** Hide this app for the initial admin account (username "admin"). */
  hideForInitialAdmin?: boolean;
  /** Optional feature flag required for the app to be visible. */
  requiresFeature?: 'recordingEnabled';
  /** Optional icon ID; defaults to the app id. */
  iconId?: string;
}

export function isAppVisible(app: AppMeta, user: SafeUser, version: VersionInfo | null | undefined): boolean {
  if (user.disabledApps.includes(app.id)) return false;
  if (app.adminOnly && !user.isAdmin) return false;
  if (app.hideForInitialAdmin && user.isInitialAdmin) return false;
  if (app.requiresFeature === 'recordingEnabled' && !version?.recordingEnabled) return false;
  return true;
}

export const APPS: AppMeta[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/', hideForInitialAdmin: true },
  {
    id: 'notes',
    label: 'Tagebuch',
    path: '/tagebuch',
    description: 'Persönliche Tagebucheinträge pro Spieler hinterlegen und mit der KI überarbeiten lassen.',
    disableable: true,
    hideForInitialAdmin: true,
  },
  {
    id: 'bingo',
    label: 'Bingo',
    path: '/bingo',
    description: 'Aufgaben sammeln, Bingo-Runde starten und gegeneinander spielen.',
    disableable: true,
    hideForInitialAdmin: true,
  },
  {
    id: 'world',
    label: 'Welt',
    path: '/welt',
    description: 'Übersicht aller bekannten Personen, Organisationen und Orte.',
    disableable: true,
    hideForInitialAdmin: true,
  },
  {
    id: 'sessions',
    label: 'Sessions',
    path: '/sessions',
    description: 'Discord-Sessions aufnehmen, transkribieren und als Text einsehen.',
    disableable: true,
    requiresFeature: 'recordingEnabled',
  },
  { id: 'admin', label: 'Admin', path: '/admin', adminOnly: true, iconId: 'admin' },
];

export function getAppByPath(path: string): AppMeta | undefined {
  return APPS.find((app) => app.path === path);
}
