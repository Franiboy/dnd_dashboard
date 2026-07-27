export interface AppMeta {
  id: string;
  label: string;
  path: string;
  disableable?: boolean;
}

export const APPS: AppMeta[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/' },
  { id: 'notes', label: 'Notizen', path: '/notizen', disableable: true },
  { id: 'bingo', label: 'Bingo', path: '/bingo', disableable: true },
  { id: 'world', label: 'Welt', path: '/welt', disableable: true },
  { id: 'recordings', label: 'Aufnahmen', path: '/recordings', disableable: true },
  { id: 'admin', label: 'Admin', path: '/admin' },
];

export function getAppByPath(path: string): AppMeta | undefined {
  return APPS.find((app) => app.path === path);
}
