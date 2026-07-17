import { useState } from 'react';

interface AvatarProps {
  src?: string | null;
  name: string;
  className?: string;
}

export function Avatar({ src, name, className = 'w-6 h-6' }: AvatarProps) {
  const [error, setError] = useState(false);
  const initials = name.charAt(0).toUpperCase();

  if (src && !error) {
    return (
      <img
        src={src}
        alt=""
        className={`rounded-full object-cover bg-slate-800 ${className}`}
        onError={() => setError(true)}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-slate-800 text-slate-400 text-[10px] font-medium ${className}`}
    >
      {initials}
    </span>
  );
}
