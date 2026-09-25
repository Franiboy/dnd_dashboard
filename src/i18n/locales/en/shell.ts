export const shell = {
  layout: {
    header: 'App shell',
  },
  home: {
    title: 'DnD Dashboard',
    subtitle: 'Choose an area',
    noApps: 'No areas available.',
    characterRequired:
      'No character has been assigned to you yet, so the diary is hidden. Please contact an admin.',
  },
  apps: {
    navigation: 'App navigation',
    picker: 'App picker',
    empty: 'No apps available.',
    dashboard: {
      label: 'Dashboard',
    },
    notes: {
      label: 'Diary',
      description: 'Keep personal diary entries for each player and revise them with the AI.',
    },
    bingo: {
      label: 'Bingo',
      description: 'Collect tasks, start a bingo round, and play against each other.',
    },
    world: {
      label: 'World',
      description: 'An overview of all known people, organizations, and places.',
    },
    timeline: {
      label: 'Timeline',
      description:
        'A timeline of the most important campaign events with links to diary entries and sessions.',
    },
    sessions: {
      label: 'Sessions',
      description: 'Record Discord sessions, transcribe them, and read them as text.',
    },
    whiteboard: {
      label: 'Whiteboard',
      description:
        'A shared board for notes and tasks – public at the top, with your private area below.',
    },
    admin: {
      label: 'Admin',
    },
  },
  chapterFilter: {
    all: 'All chapters',
    none: 'No chapter',
    chapter: 'Chapter',
    chapterNumber: 'Chapter {number}',
    title: 'Chapter filter – {label}',
    defaultTitle: 'Chapter filter (applies to sessions, diary, and world)',
    campaign: '✦ The campaign',
    legend:
      'Gold frame = selected · Green = currently running · Applies to sessions · diary · world',
    gameDay: 'Game day {day}',
    gameDayRange: 'Game day {start}–{end}',
  },
  search: {
    trigger: 'Search',
    title: 'Global search (Ctrl+K)',
    shortcut: 'Ctrl K',
    placeholder: 'Search diaries, sessions, timeline, and the world…',
    inputLabel: 'Global search',
    dialogLabel: 'Global search',
    listLabel: 'Search results',
    searching: 'Searching…',
    closeTitle: 'Close (Esc)',
    close: 'Close',
    minimumQuery:
      'Type at least two characters to search diaries, session transcripts, the timeline, and the world.',
    noResults: 'No results for “{query}”.',
    groups: {
      world: 'World',
      knowledge: 'Knowledge',
      diary: 'Diary',
      sessions: 'Sessions',
      timeline: 'Timeline',
    },
    hints: {
      alias: 'Alias',
      summary: 'Short info',
    },
    matchedVia: 'matched via {hint}',
    gameDay: 'Game day {day}',
    gameDayRange: 'Game day {start}–{end}',
    createdAt: 'Created on {date}',
    startedAt: 'Started on {date}',
    validFrom: 'Valid from game day {day}',
    validUntil: 'through game day {day}',
    select: '↑ ↓ Select',
    open: '⏎ Open',
    closeHint: 'Esc Close',
  },
} as const;
