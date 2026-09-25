export const timeline = {
  drawer: {
    label: 'Aktualisieren',
    description:
      'Die Zeitleiste zeigt nennenswerte Ereignisse aller Spieltage – KI-generiert aus den Session-Zusammenfassungen. Neu abgeschlossene Sessions werden nachts automatisch ergänzt; hier kannst du zusätzlich von Hand aktualisieren (auch für ältere Sessions).',
    update: 'Zeitleiste aktualisieren',
    updating: 'Wird aktualisiert...',
    pendingSessions: {
      one: '1 Session ohne aktuelle Ereignisse',
      other: '{formattedCount} Sessions ohne aktuelle Ereignisse',
    },
  },
  empty: {
    title: 'Noch keine Zeitleisten-Ereignisse vorhanden.',
    adminHelp:
      'Öffne „Aktualisieren“ im SideDrawer, um die Ereignisse der bisherigen Sessions zu generieren.',
    filtered: 'Keine Ereignisse im gewählten Kapitel vorhanden.',
  },
  links: {
    session: 'Session',
    diary: 'Tagebuch',
    diaryByUser: 'Tagebuch von {name}',
    openDiary: 'Tagebuch öffnen',
  },
  events: {
    moreOnDay: 'Weitere Ereignisse an diesem Tag',
    panGesture: 'Mausrad / Wischen',
    panAction: 'Ausschnitt bewegen',
    zoomGesture: 'Strg+Mausrad / 2 Finger',
    zoomAction: 'Zoom: Unter-Ereignisse aufklappen',
    clickGesture: 'Klick',
    clickAction: 'Details öffnen',
    day: 'Tag {day}',
    current: 'aktuell',
    clickForDetails: 'Klicken für Details',
    noScenes: 'Keine Unter-Ereignisse erfasst.',
    moreEvents: 'Weitere Ereignisse: {titles}',
    eventDetails: 'Ereignisdetails: {title}',
  },
  status: {
    modelLoading: 'KI-Modell wird geladen...',
    working: 'KI arbeitet an der Zeitleiste...',
    extracting: 'Ereignisse werden extrahiert...',
    almostDone: 'Fast fertig...',
    alreadyCurrent: 'Die Zeitleiste ist bereits aktuell.',
    processingSession: 'Session „{name}“ ({current}/{total}) wird verarbeitet...',
    completed: 'Aktualisierung der Zeitleiste abgeschlossen.',
  },
  notifications: {
    updated: 'Zeitleiste aktualisiert.',
  },
} as const;
