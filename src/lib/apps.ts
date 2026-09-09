import type { SafeUser, VersionInfo } from '../../shared/types';

export interface AppMeta {
  id: string;
  label: string;
  path: string;
  /** Short description shown on the home dashboard. */
  description?: string;
  disableable?: boolean;
  adminOnly?: boolean;
  /** Optional feature flag required for the app to be visible. */
  requiresFeature?: 'recordingEnabled';
  /**
   * Players need an admin-assigned character to see this app; dungeon masters
   * and admins are exempt (see isAppVisible).
   */
  requiresCharacter?: boolean;
  /** Optional icon ID; defaults to the app id. */
  iconId?: string;
}

export function isAppVisible(
  app: AppMeta,
  user: SafeUser,
  version: VersionInfo | null | undefined
): boolean {
  // Admins have unrestricted access to every app.
  if (user.isAdmin) return true;
  if (user.disabledApps.includes(app.id)) return false;
  if (app.adminOnly && !user.isAdmin) return false;
  if (app.requiresFeature === 'recordingEnabled' && !version?.recordingEnabled) return false;
  if (app.requiresCharacter && user.role === 'player' && !user.activePerson) return false;
  return true;
}

export const APPS: AppMeta[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/' },
  {
    id: 'notes',
    label: 'Tagebuch',
    path: '/tagebuch',
    description:
      'Persönliche Tagebucheinträge pro Spieler hinterlegen und mit der KI überarbeiten lassen.',
    disableable: true,
    requiresCharacter: true,
  },
  {
    id: 'bingo',
    label: 'Bingo',
    path: '/bingo',
    description: 'Aufgaben sammeln, Bingo-Runde starten und gegeneinander spielen.',
    disableable: true,
  },
  {
    id: 'world',
    label: 'Welt',
    path: '/welt',
    description: 'Übersicht aller bekannten Personen, Organisationen und Orte.',
    disableable: true,
  },
  {
    id: 'sessions',
    label: 'Sessions',
    path: '/sessions',
    description: 'Discord-Sessions aufnehmen, transkribieren und als Text einsehen.',
    disableable: true,
    requiresFeature: 'recordingEnabled',
  },
  {
    id: 'whiteboard',
    label: 'Whiteboard',
    path: '/whiteboard',
    description:
      'Gemeinsames Board für Notizen und Aufgaben – oben öffentlich, darunter dein privater Bereich.',
    disableable: true,
  },
  { id: 'admin', label: 'Admin', path: '/admin', adminOnly: true, iconId: 'admin' },
];

export function getAppByPath(path: string): AppMeta | undefined {
  return APPS.find((app) => app.path === path);
}
