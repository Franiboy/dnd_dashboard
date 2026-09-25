import type { SafeUser, VersionInfo } from '../../shared/types';
import { translate, type TFunction, type TranslationKey } from '../i18n';

/** Stable identifiers used by routes, permissions, and persisted settings. */
export type AppId =
  'dashboard' | 'notes' | 'bingo' | 'world' | 'timeline' | 'sessions' | 'whiteboard' | 'admin';

export interface AppMeta {
  id: string;
  /** German fallback for legacy callers; UI surfaces should use getAppLabel. */
  label: string;
  path: string;
  /** Short fallback description shown on the home dashboard. */
  description?: string;
  /** Translation key for the user-facing app name. */
  labelKey?: TranslationKey;
  /** Translation key for the optional home-dashboard description. */
  descriptionKey?: TranslationKey;
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

/** Central mapping from stable app ids to their user-facing translation keys. */
export const APP_LABEL_KEYS: Record<AppId, TranslationKey> = {
  dashboard: 'shell.apps.dashboard.label',
  notes: 'shell.apps.notes.label',
  bingo: 'shell.apps.bingo.label',
  world: 'shell.apps.world.label',
  timeline: 'shell.apps.timeline.label',
  sessions: 'shell.apps.sessions.label',
  whiteboard: 'shell.apps.whiteboard.label',
  admin: 'shell.apps.admin.label',
};

export const APP_DESCRIPTION_KEYS: Partial<Record<AppId, TranslationKey>> = {
  notes: 'shell.apps.notes.description',
  bingo: 'shell.apps.bingo.description',
  world: 'shell.apps.world.description',
  timeline: 'shell.apps.timeline.description',
  sessions: 'shell.apps.sessions.description',
  whiteboard: 'shell.apps.whiteboard.description',
};

const fallbackLabel = (id: AppId): string => translate('de', APP_LABEL_KEYS[id]);
const fallbackDescription = (id: AppId): string | undefined => {
  const key = APP_DESCRIPTION_KEYS[id];
  return key ? translate('de', key) : undefined;
};

function appIdFrom(app: AppMeta | string): AppId | undefined {
  const id = typeof app === 'string' ? app : app.id;
  return Object.prototype.hasOwnProperty.call(APP_LABEL_KEYS, id) ? (id as AppId) : undefined;
}

/** Resolve an app's translated display name without coupling routes to copy. */
export function getAppLabel(app: AppMeta | string, t: TFunction): string {
  if (typeof app !== 'string' && app.labelKey) return t(app.labelKey);
  const id = appIdFrom(app);
  if (id) return t(APP_LABEL_KEYS[id]);
  return typeof app === 'string' ? app : app.label;
}

/** Resolve an app's translated home description, if it has one. */
export function getAppDescription(app: AppMeta | string, t: TFunction): string | undefined {
  if (typeof app !== 'string' && app.descriptionKey) return t(app.descriptionKey);
  const id = appIdFrom(app);
  if (id && APP_DESCRIPTION_KEYS[id]) return t(APP_DESCRIPTION_KEYS[id]!);
  return typeof app === 'string' ? undefined : app.description;
}

export interface AppUiText {
  label: string;
  description?: string;
}

/** Resolve all user-facing app copy in one place for cards, menus, and search. */
export function getAppUiText(app: AppMeta | string, t: TFunction): AppUiText {
  const label = getAppLabel(app, t);
  const description = getAppDescription(app, t);
  return description ? { label, description } : { label };
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
  {
    id: 'dashboard',
    label: fallbackLabel('dashboard'),
    path: '/',
    labelKey: APP_LABEL_KEYS.dashboard,
  },
  {
    id: 'notes',
    label: fallbackLabel('notes'),
    path: '/tagebuch',
    description: fallbackDescription('notes'),
    labelKey: APP_LABEL_KEYS.notes,
    descriptionKey: APP_DESCRIPTION_KEYS.notes,
    disableable: true,
    requiresCharacter: true,
  },
  {
    id: 'bingo',
    label: fallbackLabel('bingo'),
    path: '/bingo',
    description: fallbackDescription('bingo'),
    labelKey: APP_LABEL_KEYS.bingo,
    descriptionKey: APP_DESCRIPTION_KEYS.bingo,
    disableable: true,
  },
  {
    id: 'world',
    label: fallbackLabel('world'),
    path: '/welt',
    description: fallbackDescription('world'),
    labelKey: APP_LABEL_KEYS.world,
    descriptionKey: APP_DESCRIPTION_KEYS.world,
    disableable: true,
  },
  {
    id: 'timeline',
    label: fallbackLabel('timeline'),
    path: '/zeitleiste',
    description: fallbackDescription('timeline'),
    labelKey: APP_LABEL_KEYS.timeline,
    descriptionKey: APP_DESCRIPTION_KEYS.timeline,
    disableable: true,
  },
  {
    id: 'sessions',
    label: fallbackLabel('sessions'),
    path: '/sessions',
    description: fallbackDescription('sessions'),
    labelKey: APP_LABEL_KEYS.sessions,
    descriptionKey: APP_DESCRIPTION_KEYS.sessions,
    disableable: true,
    requiresFeature: 'recordingEnabled',
  },
  {
    id: 'whiteboard',
    label: fallbackLabel('whiteboard'),
    path: '/whiteboard',
    description: fallbackDescription('whiteboard'),
    labelKey: APP_LABEL_KEYS.whiteboard,
    descriptionKey: APP_DESCRIPTION_KEYS.whiteboard,
    disableable: true,
  },
  {
    id: 'admin',
    label: fallbackLabel('admin'),
    path: '/admin',
    labelKey: APP_LABEL_KEYS.admin,
    adminOnly: true,
    iconId: 'admin',
  },
];

export function getAppByPath(path: string): AppMeta | undefined {
  return APPS.find((app) => app.path === path);
}

export function getAppById(id: string): AppMeta | undefined {
  return APPS.find((app) => app.id === id);
}
