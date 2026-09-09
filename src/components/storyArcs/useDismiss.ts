import { useEffect, type RefObject } from 'react';

/**
 * Closes a popover on outside pointerdown or Escape. Attach the ref to the
 * container that holds both the trigger and the popover content.
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void
): void {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, active, onClose]);
}
