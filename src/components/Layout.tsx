import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import type { SafeUser, VersionInfo } from '../../shared/types';

interface PreviewItem {
  id: number;
  title: string;
  previewUrl: string | null;
}

interface LayoutProps {
  user: SafeUser;
  onLogout: () => void;
  children: ReactNode;
}

export function Layout({ user, onLogout, children }: LayoutProps) {
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [previewsOpen, setPreviewsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/version')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: VersionInfo | null) => {
        if (data && typeof data.mainVersion === 'number' && typeof data.branch === 'string') {
          setVersion(data);
        }
      })
      .catch(() => {
        // Version is optional; failing silently is fine
      });
  }, []);

  useEffect(() => {
    if (!user.isAdmin && !user.canAccessPreviews) return;

    fetch('/api/ai/previews', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { previews: PreviewItem[] } | null) => {
        if (data) setPreviews(data.previews || []);
      })
      .catch(() => {
        // Previews are optional; failing silently is fine
      });
  }, [user.isAdmin, user.canAccessPreviews]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setPreviewsOpen(false);
      }
    }
    if (previewsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [previewsOpen]);

  const canMergeFromMain =
    version &&
    version.branch !== 'main' &&
    version.behind > 0 &&
    version.mainServerUrl &&
    version.previewFeatureRequestId != null;

  async function handleMergeFromMain() {
    if (!version?.mainServerUrl || version.previewFeatureRequestId == null) return;
    setIsMerging(true);
    try {
      const res = await fetch(
        `${version.mainServerUrl}/api/ai/feature-requests/${version.previewFeatureRequestId}/merge-from-main`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        console.error('Merge from main failed:', payload.error || 'Unknown error');
      }
    } catch (err) {
      console.error('Merge from main error:', err);
    } finally {
      setIsMerging(false);
    }
  }

  const isMain = version?.branch === 'main';
  const currentPreviewId = version?.previewFeatureRequestId ?? null;
  const otherPreviews = isMain
    ? previews
    : previews.filter((p) => p.id !== currentPreviewId);
  const showPreviewsDropdown =
    (user.isAdmin || user.canAccessPreviews) &&
    (isMain ? otherPreviews.length > 0 : otherPreviews.length > 0 || !!version?.mainServerUrl);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="grid grid-cols-3 items-center px-6 py-3 border-b border-[var(--border)] bg-[var(--panel)]">
        <div className="flex items-center gap-3 font-semibold text-[var(--text-h)]">
          {user.avatarUrl && <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />}
          <span>{user.displayName}</span>
        </div>

        <div className="flex justify-center">
          {version && (
            <div className="flex flex-col items-center">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black font-mono text-[var(--text-h)] drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)] transition-transform duration-200 hover:scale-110">
                  v.{version.mainVersion}
                </span>
{user.isAdmin && version.branch === 'main' && version.aiEnabled && (
                  <Button
                    as="a"
                    to="/feature-request"
                    variant="accent"
                    className="!px-2 !py-1 !rounded-full !text-xs !font-semibold"
                  >
                    Feature Request
                  </Button>
                )}
                {showPreviewsDropdown && (
                  <div className="relative" ref={dropdownRef}>
                    <button
                      onClick={() => setPreviewsOpen((open) => !open)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-700 text-[var(--text-h)] text-xs font-semibold hover:bg-slate-600 transition"
                      title="Zu einer Preview springen"
                    >
                      Previews
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {previewsOpen && (
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-56 rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-lg z-50 max-h-60 overflow-auto">
                        {!isMain && version.mainServerUrl && (
                          <a
                            href={version.mainServerUrl}
                            className="block px-3 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-slate-700/50 border-b border-[var(--border)]"
                            title="Zurück zu main"
                          >
                            Main
                          </a>
                        )}
                        {otherPreviews.map((preview) => (
                          <a
                            key={preview.id}
                            href={preview.previewUrl || '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="block px-3 py-2 text-xs text-[var(--text-h)] hover:bg-slate-700/50 border-b border-[var(--border)] last:border-0"
                            title={preview.title}
                          >
                            #{preview.id} {preview.title}
                          </a>
                        ))}
                        {!isMain && otherPreviews.length === 0 && !version.mainServerUrl && (
                          <span className="block px-3 py-2 text-xs text-slate-500">Keine weiteren Previews</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {!isMain && (
                <span className="text-[10px] leading-none px-1.5 py-0.5 rounded-full bg-[var(--warning)] text-slate-900 font-semibold mt-1">
                  {version.branch}
                  {version.ahead > 0 ? ` +${version.ahead}` : ''}
                  {version.behind > 0 ? ` -${version.behind}` : ''}
                </span>
              )}
              {canMergeFromMain && (
                <button
                  onClick={handleMergeFromMain}
                  disabled={isMerging}
                  className="mt-1 px-2 py-0.5 rounded-full bg-[var(--danger)] text-white text-[10px] font-semibold hover:brightness-110 disabled:opacity-50"
                  title={`${version.behind} Commit(s) hinter main`}
                >
                  {isMerging ? 'Merge...' : `Main reinmergen (${version.behind})`}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-4">
          {user.isAdmin && (
            <Button as="a" to="/admin" variant="ghost">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Admin
            </Button>
          )}
          <Button as="button" onClick={onLogout} variant="danger">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Logout
          </Button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
