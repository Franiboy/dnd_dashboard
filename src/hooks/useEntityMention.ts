import { useCallback, useEffect, useRef, useState } from 'react';
import type Quill from 'quill';
import type { EntityMapping } from '../../shared/types';
import { detectMention, filterEntityMentions, type MentionSuggestion } from '../lib/entityMention';

export interface ActiveMention {
  atIndex: number;
  query: string;
  cursorIndex: number;
  suggestions: MentionSuggestion[];
  activeIndex: number;
  position: { top: number; left: number };
}

interface UseEntityMentionOptions {
  getQuill: () => Quill | null;
  mappings: EntityMapping[];
  enabled?: boolean;
}

function computePosition(quill: Quill, atIndex: number): { top: number; left: number } {
  try {
    const bounds = quill.getBounds(atIndex);
    if (!bounds) return { top: 24, left: 8 };
    const rootRect = quill.root.getBoundingClientRect();
    // Viewport-relative coordinates: the dropdown uses `position: fixed`,
    // so it stays correct inside modals, drawers and scrolled containers.
    const left = Math.max(8, Math.min(rootRect.left + bounds.left, window.innerWidth - 300));
    const below = rootRect.top + bounds.top + bounds.height + 6;
    const dropdownHeight = 240;
    const top =
      below + dropdownHeight > window.innerHeight && rootRect.top + bounds.top - dropdownHeight > 8
        ? rootRect.top + bounds.top - dropdownHeight - 6
        : below;
    return { top: Math.max(8, top), left };
  } catch {
    return { top: 24, left: 8 };
  }
}

/**
 * Binds "@entity" autocomplete to a Quill instance. Typing "@" followed by
 * text opens a suggestion list filtered from the known entity mappings.
 * Accepting a suggestion replaces "@query" with the canonical entity name
 * (the "@" disappears); dismissing leaves "@" as plain typed text.
 */
export function useEntityMention({ getQuill, mappings, enabled = true }: UseEntityMentionOptions) {
  const [mention, setMention] = useState<ActiveMention | null>(null);
  const mentionRef = useRef<ActiveMention | null>(null);
  mentionRef.current = mention;
  const mappingsRef = useRef(mappings);
  mappingsRef.current = mappings;

  const close = useCallback(() => {
    if (mentionRef.current !== null) setMention(null);
  }, []);

  const refresh = useCallback(() => {
    const quill = getQuill();
    if (!quill || !enabled) {
      if (mentionRef.current !== null) setMention(null);
      return;
    }
    const range = quill.getSelection();
    if (!range || range.length > 0) {
      if (mentionRef.current !== null) setMention(null);
      return;
    }
    const detected = detectMention(quill.getText(0, range.index));
    if (!detected) {
      if (mentionRef.current !== null) setMention(null);
      return;
    }
    const suggestions = filterEntityMentions(mappingsRef.current, detected.query);
    const prev = mentionRef.current;
    const sameQuery =
      prev !== null && prev.atIndex === detected.atIndex && prev.query === detected.query;
    const activeIndex =
      prev !== null && sameQuery
        ? Math.min(prev.activeIndex, Math.max(0, suggestions.length - 1))
        : 0;
    setMention({
      atIndex: detected.atIndex,
      query: detected.query,
      cursorIndex: range.index,
      suggestions,
      activeIndex,
      position: computePosition(quill, detected.atIndex),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const accept = useCallback(
    (suggestion: MentionSuggestion) => {
      const quill = getQuill();
      const current = mentionRef.current;
      if (!quill || !current) return;
      const selection = quill.getSelection();
      const cursor = selection ? selection.index : current.cursorIndex;
      const length = Math.max(0, cursor - current.atIndex);
      quill.deleteText(current.atIndex, length, 'user');
      quill.insertText(current.atIndex, `${suggestion.canonical} `, 'user');
      quill.setSelection(current.atIndex + suggestion.canonical.length + 1, 0, 'user');
      quill.focus();
      setMention(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const setActiveIndex = useCallback((index: number) => {
    setMention((prev) => (prev ? { ...prev, activeIndex: index } : prev));
  }, []);

  // Re-filter when the query-defining mappings change while open.
  useEffect(() => {
    if (mentionRef.current !== null) refresh();
  }, [mappings, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const acceptRef = { current: accept };
    let quill: Quill | null = getQuill();
    let detach: (() => void) | null = null;
    let disposed = false;

    const attach = (instance: Quill) => {
      const onTextChange = () => refresh();
      const onSelectionChange = () => refresh();
      const onKeyDown = (event: KeyboardEvent) => {
        const current = mentionRef.current;
        if (!current) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          const count = current.suggestions.length;
          if (count === 0) return;
          const next = (current.activeIndex + delta + count) % count;
          setMention({ ...current, activeIndex: next });
        } else if (event.key === 'Enter' || event.key === 'Tab') {
          const target = current.suggestions[current.activeIndex];
          if (target) {
            event.preventDefault();
            event.stopPropagation();
            acceptRef.current(target);
          } else {
            setMention(null);
          }
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setMention(null);
        }
      };

      instance.on('text-change', onTextChange);
      instance.on('selection-change', onSelectionChange);
      instance.root.addEventListener('keydown', onKeyDown, true);
      detach = () => {
        instance.off('text-change', onTextChange);
        instance.off('selection-change', onSelectionChange);
        instance.root.removeEventListener('keydown', onKeyDown, true);
      };
      refresh();
    };

    if (quill) {
      attach(quill);
    } else {
      // ReactQuill creates the editor asynchronously after mount.
      const timer = window.setInterval(() => {
        if (disposed) return;
        const instance = getQuill();
        if (instance) {
          window.clearInterval(timer);
          attach(instance);
        }
      }, 100);
      const timeout = window.setTimeout(() => window.clearInterval(timer), 3000);
      detach = () => {
        window.clearInterval(timer);
        window.clearTimeout(timeout);
      };
    }

    return () => {
      disposed = true;
      detach?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refresh, accept]);

  return { mention, accept, close, setActiveIndex };
}
