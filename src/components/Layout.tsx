import { Link } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import type { SafeUser, VersionInfo } from '../../shared/types';

interface LayoutProps {
  user: SafeUser;
  onLogout: () => void;
  children: ReactNode;
}

export function Layout({ user, onLogout, children }: LayoutProps) {
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [isMerging, setIsMerging] = useState(false);

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
                  <Link
                    to="/feature-request"
                    className="inline-flex items-center px-2 py-1 rounded-full bg-[var(--accent)] text-slate-900 text-xs font-semibold shadow hover:brightness-110 transition"
                    title="Feature Request"
                  >
                    Feature Request
                  </Link>
                )}
              </div>
              {version.branch !== 'main' && (
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
            <Link to="/admin" className="text-slate-400 hover:text-[var(--text-h)]">
              Admin
            </Link>
          )}
          <button
            onClick={onLogout}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--danger)]/20 text-[var(--danger)] hover:bg-[var(--danger)]/30 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Logout
          </button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
