import { describe, expect, it } from 'vitest';
import {
  annotateTranscriptSpeakers,
  resolveTranscriptSpeaker,
  type SpeakerAnnotationResult,
} from './transcriptSpeakers.js';
import type { SafeUser } from '../../shared/types.js';

const users: SafeUser[] = [
  {
    id: 'u-fenwick',
    username: 'fenwick',
    displayName: 'Fenwick',
    avatarUrl: null,
    isAdmin: false,
    isApproved: true,
    role: 'player',
    disabledApps: [],
    activePerson: 'Calzone',
    autoSessionToDiary: true,
    autoAcceptSessionDiary: false,
    themePrimary: null,
    isInitialAdmin: false,
  },
  {
    id: 'u-selenex',
    username: 'selenex',
    displayName: 'Selene',
    avatarUrl: null,
    isAdmin: false,
    isApproved: true,
    role: 'player',
    disabledApps: [],
    activePerson: 'Vimak',
    autoSessionToDiary: true,
    autoAcceptSessionDiary: false,
    themePrimary: null,
    isInitialAdmin: false,
  },
  {
    id: 'u-jori',
    username: 'warden_jori',
    displayName: 'xWarden / Jori',
    avatarUrl: null,
    isAdmin: false,
    isApproved: true,
    role: 'player',
    disabledApps: [],
    activePerson: 'Heinz-Hartmut',
    autoSessionToDiary: true,
    autoAcceptSessionDiary: false,
    themePrimary: null,
    isInitialAdmin: false,
  },
  {
    id: 'u-arrow',
    username: 'arrowmaster',
    displayName: 'Arrowmaster',
    avatarUrl: null,
    isAdmin: false,
    isApproved: true,
    role: 'player',
    disabledApps: [],
    activePerson: 'Archybald',
    autoSessionToDiary: true,
    autoAcceptSessionDiary: false,
    themePrimary: null,
    isInitialAdmin: false,
  },
  {
    id: 'u-marek',
    username: 'dm_marek',
    displayName: 'Marek',
    avatarUrl: null,
    isAdmin: false,
    isApproved: true,
    role: 'dungeon_master',
    disabledApps: [],
    activePerson: null,
    autoSessionToDiary: false,
    autoAcceptSessionDiary: false,
    themePrimary: null,
    isInitialAdmin: false,
  },
  {
    id: 'u-lorros',
    username: 'lorros_',
    displayName: 'Lorros',
    avatarUrl: null,
    isAdmin: false,
    isApproved: true,
    role: 'guest',
    disabledApps: [],
    activePerson: null,
    autoSessionToDiary: false,
    autoAcceptSessionDiary: false,
    themePrimary: null,
    isInitialAdmin: false,
  },
];

function annotate(transcript: string, authorUserId?: string): SpeakerAnnotationResult {
  return annotateTranscriptSpeakers(transcript, users, authorUserId);
}

describe('resolveTranscriptSpeaker', () => {
  it('matches the exact display name', () => {
    expect(resolveTranscriptSpeaker('Selene', users)?.id).toBe('u-selenex');
  });

  it('matches the username as fallback', () => {
    expect(resolveTranscriptSpeaker('selenex', users)?.id).toBe('u-selenex');
  });

  it('matches server nicknames via normalized containment', () => {
    expect(resolveTranscriptSpeaker('Warden | Jori', users)?.id).toBe('u-jori');
  });

  it('matches near-identical transcription typos via edit distance', () => {
    expect(resolveTranscriptSpeaker('fenwic', users)?.id).toBe('u-fenwick');
  });

  it('returns null for unknown or too short names', () => {
    expect(resolveTranscriptSpeaker('Floh', users)).toBeNull();
    expect(resolveTranscriptSpeaker('Bob', users)).toBeNull();
  });
});

describe('annotateTranscriptSpeakers', () => {
  it('replaces line-level speakers with character labels and marks the author', () => {
    const transcript = [
      '[10:00] Marek: Die Arena liegt vor euch.',
      '[10:05] Selene: Ich betrete die Arena.',
      '[10:10] Fenwick: Ich bleibe hier.',
    ].join('\n');
    const result = annotate(transcript, 'u-fenwick');

    expect(result.transcript).toContain('[10:00] Spielleiter (Marek): Die Arena liegt vor euch.');
    expect(result.transcript).toContain('[10:05] Vimak (Selene): Ich betrete die Arena.');
    expect(result.transcript).toContain('[10:10] Calzone (Fenwick) (du): Ich bleibe hier.');
  });

  it('annotates hour-format timestamps', () => {
    const result = annotate('[01:05:00] Fenwick: Ich bin noch da.', 'u-fenwick');
    expect(result.transcript).toBe('[01:05:00] Calzone (Fenwick) (du): Ich bin noch da.');
  });

  it('matches the fuzzy nickname "Warden | Jori"', () => {
    const result = annotate('[10:05] Warden | Jori: Ich wette fünf Gold.');
    expect(result.transcript).toContain(
      '[10:05] Heinz-Hartmut (Warden | Jori): Ich wette fünf Gold.'
    );
  });

  it('replaces Whisper attribution artifacts inside the text', () => {
    const transcript = [
      '[10:00] Marek: Selene:"Du bist dran."',
      '[10:01] Selene: fenwick:"Pass auf."',
      '[10:02] Marek: Selene& Marek & sagen wir es so.',
    ].join('\n');
    const result = annotate(transcript, 'u-fenwick');

    expect(result.transcript).toContain(
      '[10:00] Spielleiter (Marek): Vimak (Selene):"Du bist dran."'
    );
    expect(result.transcript).toContain(
      '[10:01] Vimak (Selene): Calzone (Fenwick) (du):"Pass auf."'
    );
    expect(result.transcript).toContain(
      '[10:02] Spielleiter (Marek): Vimak (Selene)& Spielleiter (Marek) & sagen wir es so.'
    );
  });

  it('replaces trailing ampersand chain artifacts (e.g. Marek & Selene)', () => {
    const transcript = '[04:26] Selene: Marek & Selene Ja. Ah, so rum';
    const result = annotate(transcript);
    expect(result.transcript).toBe(
      '[04:26] Vimak (Selene): Spielleiter (Marek) & Vimak (Selene) Ja. Ah, so rum'
    );
  });

  it('handles ampersand chains with various spacing', () => {
    const cases: [string, string][] = [
      [
        '[10:00] Marek: Marek & Selene Ja',
        '[10:00] Spielleiter (Marek): Spielleiter (Marek) & Vimak (Selene) Ja',
      ],
      [
        '[10:00] Marek: Marek&Selene Ja',
        '[10:00] Spielleiter (Marek): Spielleiter (Marek)&Vimak (Selene) Ja',
      ],
      [
        '[10:00] Marek: Selene& Marek & Selene Ja',
        '[10:00] Spielleiter (Marek): Vimak (Selene)& Spielleiter (Marek) & Vimak (Selene) Ja',
      ],
    ];
    for (const [input, expected] of cases) {
      expect(annotate(input).transcript).toBe(expected);
    }
  });

  it('leaves unknown speakers and normal speech mentions unchanged', () => {
    const transcript = '[10:00] Floh: Selene ist ein Goliath. Vimak ist auch da.';
    const result = annotate(transcript, 'u-fenwick');
    expect(result.transcript).toBe(transcript);
  });

  it('keeps players without a character label unchanged', () => {
    const result = annotate('[10:00] Lorros: Hallo zusammen.');
    expect(result.transcript).toBe('[10:00] Lorros: Hallo zusammen.');
  });

  it('builds mapping lines for the prompt', () => {
    const transcript = [
      '[10:00] Marek: Los.',
      '[10:01] Selene: Ich gehe.',
      '[10:02] Fenwick: Ich auch.',
      '[10:03] Warden | Jori: Warten.',
      '[10:04] Arrowmaster: Nee.',
      '[10:05] Lorros: Hallo.',
    ].join('\n');
    const result = annotate(transcript, 'u-fenwick');

    expect(result.mappingLines).toEqual([
      '- Marek → Spielleiter (DM, kein Charakter)',
      '- Selene → Vimak',
      '- Fenwick → Calzone (dein Charakter)',
      '- Warden | Jori → Heinz-Hartmut',
      '- Arrowmaster → Archybald',
      '- Lorros → keinem Charakter zugeordnet',
    ]);
  });
});
