export const shell = {
  layout: {
    header: 'App-Shell',
  },
  home: {
    title: 'DnD Dashboard',
    subtitle: 'Wähle einen Bereich',
    noApps: 'Keine Bereiche verfügbar.',
    characterRequired:
      'Dir ist noch kein Charakter zugewiesen – daher ist das Tagebuch ausgeblendet. Bitte wende dich an einen Admin.',
  },
  apps: {
    navigation: 'App-Navigation',
    picker: 'App-Auswahl',
    empty: 'Keine Apps verfügbar.',
    dashboard: {
      label: 'Dashboard',
    },
    notes: {
      label: 'Tagebuch',
      description:
        'Persönliche Tagebucheinträge pro Spieler hinterlegen und mit der KI überarbeiten lassen.',
    },
    bingo: {
      label: 'Bingo',
      description: 'Aufgaben sammeln, Bingo-Runde starten und gegeneinander spielen.',
    },
    world: {
      label: 'Welt',
      description: 'Übersicht aller bekannten Personen, Organisationen und Orte.',
    },
    timeline: {
      label: 'Zeitleiste',
      description:
        'Zeitstrahl der wichtigsten Kampagnenereignisse mit Sprung in Tagebuch und Session.',
    },
    sessions: {
      label: 'Sessions',
      description: 'Discord-Sessions aufnehmen, transkribieren und als Text einsehen.',
    },
    whiteboard: {
      label: 'Whiteboard',
      description:
        'Gemeinsames Board für Notizen und Aufgaben – oben öffentlich, darunter dein privater Bereich.',
    },
    admin: {
      label: 'Admin',
    },
  },
  chapterFilter: {
    all: 'Alle Kapitel',
    none: 'Ohne Kapitel',
    chapter: 'Kapitel',
    chapterNumber: 'Kapitel {number}',
    title: 'Kapitel-Filter – {label}',
    defaultTitle: 'Kapitel-Filter (wirkt auf Sessions, Tagebuch und Welt)',
    campaign: '✦ Die Kampagne',
    legend:
      'Goldener Rahmen = ausgewählt · Grün = läuft gerade · Filter gilt für Sessions · Tagebuch · Welt',
    gameDay: 'Spieltag {day}',
    gameDayRange: 'Spieltag {start}–{end}',
  },
  search: {
    trigger: 'Suche',
    title: 'Globale Suche (Ctrl+K)',
    shortcut: 'Ctrl K',
    placeholder: 'Tagebücher, Sessions, Zeitleiste und Welt durchsuchen…',
    inputLabel: 'Globale Suche',
    dialogLabel: 'Globale Suche',
    listLabel: 'Suchergebnisse',
    searching: 'Suche …',
    closeTitle: 'Schließen (Esc)',
    close: 'Schließen',
    minimumQuery:
      'Tippe mindestens zwei Zeichen, um Tagebücher, Session-Transkripte, die Zeitleiste und die Welt zu durchsuchen.',
    noResults: 'Keine Treffer für „{query}“.',
    groups: {
      world: 'Welt',
      knowledge: 'Wissen',
      diary: 'Tagebuch',
      sessions: 'Sessions',
      timeline: 'Zeitleiste',
    },
    hints: {
      alias: 'Alias',
      summary: 'Kurzinfo',
    },
    matchedVia: 'getroffen via {hint}',
    gameDay: 'Spieltag {day}',
    gameDayRange: 'Spieltag {start}–{end}',
    createdAt: 'Erstellt am {date}',
    startedAt: 'Gestartet am {date}',
    validFrom: 'Gültig ab Spieltag {day}',
    validUntil: 'bis Spieltag {day}',
    select: '↑ ↓ Auswählen',
    open: '⏎ Öffnen',
    closeHint: 'Esc Schließen',
  },
} as const;
