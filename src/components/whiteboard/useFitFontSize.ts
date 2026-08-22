import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Finds the largest font size at which `text` still fits into the measured
 * node (binary search on scrollHeight/scrollWidth). Runs on every text or
 * box change so typing live-adapts the size to fill the note.
 */
export function useFitFontSize(
  text: string,
  availableWidth: number,
  availableHeight: number,
  enabled: boolean
) {
  const ref = useRef<HTMLElement | null>(null);
  const [fontSize, setFontSize] = useState(14);
  const [padTop, setPadTop] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) {
      setPadTop(0);
      return;
    }

    // Empty notes center their placeholder vertically.
    if (!text.trim()) {
      const base = Math.min(15, availableHeight / 5);
      el.style.fontSize = `${base}px`;
      setFontSize(base);
      setPadTop(Math.max(0, (availableHeight - base * 1.15) / 2));
      return;
    }

    const fits = (px: number) => {
      el.style.fontSize = `${px}px`;
      return el.scrollHeight <= availableHeight + 0.5 && el.scrollWidth <= availableWidth + 0.5;
    };
    let lo = 6;
    let hi = 600;
    for (let i = 0; i < 50; i += 1) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    // Headroom so rounding/wrap edges never spill into a scrollbar.
    const fitted = Math.max(6, lo * 0.97);
    el.style.fontSize = `${fitted}px`;
    setFontSize((prev) => (Math.abs(prev - fitted) > 0.3 ? fitted : prev));
    setPadTop(0);
  }, [text, availableWidth, availableHeight, enabled]);

  return { ref, fontSize, padTop };
}
