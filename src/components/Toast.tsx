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
      : 'bg-[var(--accent)] text-slate-900';

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
      <div className={`${colorClasses} px-6 py-3 rounded-lg shadow-xl font-medium animate-bounce`}>
        {message}
      </div>
    </div>
  );
}
