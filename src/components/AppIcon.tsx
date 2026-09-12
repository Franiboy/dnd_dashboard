interface AppIconProps {
  id: string;
  size?: number;
  className?: string;
}

const COMMON_PROPS = {
  xmlns: 'http://www.w3.org/2000/svg',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
} as const;

export function AppIcon({ id, size = 20, className }: AppIconProps) {
  switch (id) {
    case 'dashboard':
      return (
        <svg {...COMMON_PROPS} width={size} height={size} className={className}>
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case 'notes':
      return (
        <svg {...COMMON_PROPS} width={size} height={size} className={className}>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      );
    case 'bingo':
      return (
        <svg {...COMMON_PROPS} width={size} height={size} className={className}>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="8.5" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="8.5" width="7" height="7" />
          <rect x="8.5" y="8.5" width="7" height="7" />
          <rect x="14" y="8.5" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="8.5" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      );
    case 'world':
      return (
        <svg {...COMMON_PROPS} width={size} height={size} className={className}>
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      );
    case 'sessions':
      return (
        <svg {...COMMON_PROPS} width={size} height={size} className={className}>
          <path d="M2 10v3" />
          <path d="M6 6v11" />
          <path d="M10 3v18" />
          <path d="M14 8v9" />
          <path d="M18 5v14" />
          <path d="M22 10v3" />
        </svg>
      );
    case 'timeline':
      return (
        <svg {...COMMON_PROPS} width={size} height={size} className={className}>
          <line x1="3" y1="12" x2="21" y2="12" />
          <circle cx="7" cy="12" r="2" />
          <circle cx="13" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      );
    case 'whiteboard':
      return (
        <svg {...COMMON_PROPS} width={size} height={size} className={className}>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
        </svg>
      );
    case 'admin':
      return (
        <svg {...COMMON_PROPS} width={size} height={size} className={className}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
        </svg>
      );
    case 'logout':
      return (
        <svg {...COMMON_PROPS} width={size} height={size} className={className}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      );
    case 'undo':
      return (
        <svg {...COMMON_PROPS} width={size} height={size} className={className}>
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      );
    default:
      return (
        <svg {...COMMON_PROPS} width={size} height={size} className={className}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18" />
        </svg>
      );
  }
}
