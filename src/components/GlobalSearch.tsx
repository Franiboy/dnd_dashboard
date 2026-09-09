import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useGlobalSearch, type EntitySearchHit } from '../hooks/useGlobalSearch';
import { useEntityDialog } from '../hooks/useEntityDialog';
import { typeLabels } from '../lib/entityLabels';
import { APPS, isAppVisible } from '../lib/apps';
import type { EntityType, SafeUser, SearchResult, VersionInfo } from '../../shared/types';

// Same per-type badge colors as EntityMentionDropdown.
const entityTypeStyles: Record<EntityType, string> = {
  persons: 'bg-[var(--accent)]/15 text-[var(--accent)]',
  organizations: 'bg-blue-500/15 text-blue-400',
  locations: 'bg-amber-500/15 text-amber-400',
  items: 'bg-emerald-500/15 text-emerald-400',
};

interface GlobalSearchProps {
  user: SafeUser;
  version: VersionInfo | null | undefined;
}

/** Renders a search snippet with \u0001 … \u0002 match ranges highlighted. */
function Snippet({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let marked = false;
  let buf = '';
  let key = 0;
  const flush = () => {
    if (!buf) return;
    nodes.push(
      marked ? (
        <mark key={key++} className="bg-transparent text-[var(--accent)] font-semibold">
          {buf}
        </mark>
      ) : (
        <span key={key++}>{buf}</span>
      )
    );
    buf = '';
  };
  for (const ch of text) {
    if (ch === '\u0001') {
      flush();
      marked = true;
    } else if (ch === '\u0002') {
      flush();
      marked = false;
    } else {
      buf += ch;
    }
  }
  flush();
  return <>{nodes}</>;
}

const searchIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

type FlatEntry =
  | { kind: 'entity'; group: string; hit: EntitySearchHit }
  | { kind: 'result'; group: string; hit: SearchResult };

export function GlobalSearch({ user, version }: GlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { openEntity } = useEntityDialog();
  const { entityHits, results, loading } = useGlobalSearch(query, open);

  // Groups of disabled apps are hidden so the search never offers results the
  // user cannot reach.
  const appVisible = (id: string) => {
    const app = APPS.find((a) => a.id === id);
    return !!app && isAppVisible(app, user, version);
  };
  const showWorld = appVisible('world');
  const showDiary = appVisible('notes');
  const showSessions = appVisible('sessions');

  // Stable display order: world entities, knowledge facts, diary, sessions.
  const entries = useMemo<FlatEntry[]>(() => {
    const list: FlatEntry[] = [];
    if (showWorld) {
      for (const hit of entityHits) list.push({ kind: 'entity', group: 'Welt', hit });
      for (const hit of results) {
        if (hit.source === 'knowledge') list.push({ kind: 'result', group: 'Wissen', hit });
      }
    }
    if (showDiary) {
      for (const hit of results) {
        if (hit.source === 'diary') list.push({ kind: 'result', group: 'Tagebuch', hit });
      }
    }
    if (showSessions) {
      for (const hit of results) {
        if (hit.source === 'session') list.push({ kind: 'result', group: 'Sessions', hit });
      }
    }
    return list;
  }, [entityHits, results, showWorld, showDiary, showSessions]);

  // Derived clamp: results shrink while typing, so the stored index can point
  // past the end; computing it during render avoids a cascading setState.
  const currentIndex = Math.min(activeIndex, Math.max(entries.length - 1, 0));

  // Global Ctrl/Cmd+K toggles the palette.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Opening resets the search and refocuses the input (DOM side effect only).
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep the keyboard selection visible while arrowing through long lists.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [currentIndex, entries]);

  function close() {
    setOpen(false);
  }

  function openPalette() {
    setQuery('');
    setActiveIndex(0);
    setOpen(true);
  }

  function select(entry: FlatEntry) {
    close();
    if (entry.kind === 'entity') {
      const hit = entry.hit;
      // No navigation: EntityDialogRouteSync closes dialogs on route changes,
      // and the provider is mounted app-wide.
      openEntity(hit.name, hit.type, undefined, hit.qualifier);
      return;
    }
    const hit = entry.hit;
    if (hit.source === 'knowledge') {
      openEntity(hit.entityName, hit.entityType, undefined, hit.entityQualifier, 'knowledge');
    } else if (hit.source === 'diary') {
      navigate(`/tagebuch?entry=${hit.id}`);
    } else if (hit.source === 'session') {
      navigate(
        hit.transcriptTime
          ? `/sessions?session=${hit.id}&t=${encodeURIComponent(hit.transcriptTime)}`
          : `/sessions?session=${hit.id}`
      );
    }
  }

  function onInputKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (entries.length === 0 ? 0 : (i + 1) % entries.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (entries.length === 0 ? 0 : (i - 1 + entries.length) % entries.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = entries[currentIndex];
      if (entry) select(entry);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  const trimmed = query.trim();
  const hasQuery = trimmed.length >= 2;

  // Group headers are rendered for the first entry of each consecutive group.
  const lastGroupByIndex = entries.map((entry, i) =>
    i > 0 && entries[i - 1].group === entry.group ? null : entry.group
  );

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        title="Globale Suche (Ctrl+K)"
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-[var(--text-h)] transition-colors"
      >
        {searchIcon}
        <span className="hidden md:inline">Suche</span>
        <kbd className="hidden lg:inline-flex items-center rounded border border-[var(--border)] bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
          Ctrl K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="mx-auto mt-[10vh] w-full max-w-xl bg-[var(--panel)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
              <span className="text-slate-400">{searchIcon}</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Tagebücher, Sessions und Welt durchsuchen…"
                className="flex-1 bg-transparent text-[var(--text-h)] placeholder:text-slate-500 focus:outline-none text-sm"
              />
              {loading && <span className="text-xs text-slate-500 animate-pulse">Suche …</span>}
              <button
                type="button"
                onClick={close}
                className="text-slate-500 hover:text-[var(--text-h)] text-xs"
                title="Schließen (Esc)"
              >
                Esc
              </button>
            </div>

            <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-2">
              {!hasQuery && (
                <p className="px-3 py-6 text-center text-sm text-slate-500">
                  Tippe mindestens zwei Zeichen, um Tagebücher, Session-Transkripte und die Welt zu
                  durchsuchen.
                </p>
              )}
              {hasQuery && entries.length === 0 && !loading && (
                <p className="px-3 py-6 text-center text-sm text-slate-500">
                  Keine Treffer für „{trimmed}“.
                </p>
              )}
              {entries.map((entry, index) => {
                const header = lastGroupByIndex[index];
                const active = index === currentIndex;
                return (
                  <div key={entryKey(entry, index)}>
                    {header && (
                      <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 select-none">
                        {header}
                      </div>
                    )}
                    <button
                      type="button"
                      data-active={active || undefined}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => select(entry)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                        active ? 'bg-slate-800' : 'hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-sm font-medium text-[var(--text-h)]">
                          {entryTitle(entry)}
                        </span>
                        <span className="ml-auto shrink-0">{entryBadge(entry)}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400 truncate">
                        {entrySubtitle(entry)}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-4 px-4 py-2 border-t border-[var(--border)] text-[11px] text-slate-500 select-none">
              <span>↑ ↓ Auswählen</span>
              <span>⏎ Öffnen</span>
              <span>Esc Schließen</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function entryKey(entry: FlatEntry, index: number): string {
  if (entry.kind === 'entity') {
    return `entity-${entry.hit.type}-${entry.hit.name}-${entry.hit.qualifier}`;
  }
  return `${entry.hit.source}-${entry.hit.id}-${index}`;
}

function entryTitle(entry: FlatEntry): string {
  if (entry.kind === 'entity') return entry.hit.label;
  return entry.hit.title;
}

function entrySubtitle(entry: FlatEntry): ReactNode {
  if (entry.kind === 'entity') {
    const hit = entry.hit;
    const hint = hit.matchOn === 'alias' ? 'Alias' : hit.matchOn === 'summary' ? 'Kurzinfo' : null;
    return hint ? <span className="text-slate-500">getroffen via {hint}</span> : null;
  }
  const hit = entry.hit;
  if (hit.source === 'knowledge') {
    return <Snippet text={hit.snippet} />;
  }
  if (hit.source === 'diary') {
    return (
      <>
        <Snippet text={hit.snippet} />
        {hit.gameDay !== null && (
          <span className="ml-2 text-slate-500">Spieltag {hit.gameDay}</span>
        )}
      </>
    );
  }
  return (
    <>
      <Snippet text={hit.snippet} />
      {hit.gameDay !== null && <span className="ml-2 text-slate-500">Spieltag {hit.gameDay}</span>}
    </>
  );
}

function entryBadge(entry: FlatEntry): ReactNode {
  if (entry.kind === 'entity') {
    return (
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${entityTypeStyles[entry.hit.type]}`}
      >
        {typeLabels[entry.hit.type]}
      </span>
    );
  }
  const hit = entry.hit;
  if (hit.source === 'knowledge') {
    return (
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${entityTypeStyles[hit.entityType]}`}
      >
        {typeLabels[hit.entityType]}
      </span>
    );
  }
  if (hit.source === 'diary') {
    return (
      <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-slate-700 text-slate-300">
        Tagebuch
      </span>
    );
  }
  return (
    <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-slate-700 text-slate-300">
      Session
    </span>
  );
}
