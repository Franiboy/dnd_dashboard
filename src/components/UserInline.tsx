import type { SafeUser } from '../../shared/types';
import { Avatar } from './Avatar';

interface UserInlineProps {
  users: SafeUser[];
  userIds?: string[];
  className?: string;
}

export function UserInline({ users, userIds, className }: UserInlineProps) {
  const matched = (userIds || [])
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is SafeUser => !!u);

  if (matched.length === 0) return null;

  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 ${className || ''}`}>
      {matched.map((u) => (
        <span key={u.id} className="inline-flex items-center gap-1 text-xs text-slate-400">
          <Avatar src={u.avatarUrl} name={u.displayName} className="w-4 h-4" />
          {u.displayName}
        </span>
      ))}
    </span>
  );
}
