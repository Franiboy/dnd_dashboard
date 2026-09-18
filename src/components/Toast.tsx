import { useEffect } from 'react';
import type { ToastType } from '../contexts/ErrorContext';

interface ToastProps {
  message: string | null;
  type?: ToastType;
  onClose: () => void;
  duration?: number;
}

export function Toast({ message, type = 'info', onClose, duration = 5000 }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onClose]);

  if (!message) return null;

  const colorClasses =
    type === 'error'
      ? 'bg-[var(--danger)] text-white'
      : 'bg-[var(--accent)] text-[var(--accent-contrast)]';

  return (
    // Sits below the header (--header-height is kept in sync by Layout) so it
    // never covers the app switcher; capped to the viewport on small screens.
    <div
      className="fixed left-1/2 z-50 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2"
      style={{ top: 'calc(var(--header-height, 0px) + 12px)' }}
    >
      <div
        className={`${colorClasses} toast-pop-in px-6 py-3 rounded-lg shadow-xl font-medium text-center`}
      >
        {message}
      </div>
    </div>
  );
}
