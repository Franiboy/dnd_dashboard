import { describe, expect, it } from 'vitest';
import {
  annotateTranscriptSpeakers,
  resolveTranscriptDisplayLanguage,
  resolveTranscriptSpeaker,
  type SpeakerAnnotationResult,
} from './transcriptSpeakers.js';
import type { Language, SafeUser } from '../../shared/types.js';

const users: SafeUser[] = [
  {
    id: 'u-rowan',
    username: 'rowan',
    displayName: 'Rowan',
    avatarUrl: null,
    isAdmin: false,
    isApproved: true,
    role: 'player',
    disabledApps: [],
    activePerson: 'Ilvane',
    autoSessionToDiary: true,
    autoAcceptSessionDiary: false,
    themePrimary: null,
    uiLanguage: null,
    isInitialAdmin: false,
  },
  {
    id: 'u-nerisx',
    username: 'nerisx',
    displayName: 'Neris',
    avatarUrl: null,
    isAdmin: false,
    isApproved: true,
    role: 'player',
    disabledApps: [],
    activePerson: 'Ruvan',
    autoSessionToDiary: true,
    autoAcceptSessionDiary: false,
    themePrimary: null,
    uiLanguage: null,
    isInitialAdmin: false,
  },
  {
    id: 'u-tovi',
    username: 'warden_tovi',
    displayName: 'xWarden / Tovi',
    avatarUrl: null,
    isAdmin: false,
    isApproved: true,
    role: 'player',
    disabledApps: [],
    activePerson: 'Bardwyn',
    autoSessionToDiary: true,
    autoAcceptSessionDiary: false,
    themePrimary: null,
    uiLanguage: null,
    isInitialAdmin: false,
  },
  {
    id: 'u-kestrel',
    username: 'kestrel',
    displayName: 'Kestrel',
    avatarUrl: null,
    isAdmin: false,
    isApproved: true,
    role: 'player',
    disabledApps: [],
    activePerson: 'Aldric',
    autoSessionToDiary: true,
    autoAcceptSessionDiary: false,
    themePrimary: null,
    uiLanguage: null,
    isInitialAdmin: false,
  },
  {
    id: 'u-torvald',
    username: 'dm_torvald',
    displayName: 'Torvald',
    avatarUrl: null,
    isAdmin: false,
    isApproved: true,
    role: 'dungeon_master',
    disabledApps: [],
    activePerson: null,
    autoSessionToDiary: false,
    autoAcceptSessionDiary: false,
    themePrimary: null,
    uiLanguage: null,
    isInitialAdmin: false,
  },
  {
    id: 'u-pell',
    username: 'pell_',
    displayName: 'Pell',
    avatarUrl: null,
    isAdmin: false,
    isApproved: true,
    role: 'guest',
    disabledApps: [],
    activePerson: null,
    autoSessionToDiary: false,
    autoAcceptSessionDiary: false,
    themePrimary: null,
    uiLanguage: null,
    isInitialAdmin: false,
  },
];

function annotate(
  transcript: string,
  authorUserId?: string,
  language: Language = 'de'
): SpeakerAnnotationResult {
  return annotateTranscriptSpeakers(transcript, users, authorUserId, language);
}

describe('resolveTranscriptSpeaker', () => {
  it('matches the exact display name', () => {
    expect(resolveTranscriptSpeaker('Neris', users)?.id).toBe('u-nerisx');
  });

  it('matches the username as fallback', () => {
    expect(resolveTranscriptSpeaker('nerisx', users)?.id).toBe('u-nerisx');
  });

  it('matches server nicknames via normalized containment', () => {
    expect(resolveTranscriptSpeaker('Warden | Tovi', users)?.id).toBe('u-tovi');
  });

  it('matches near-identical transcription typos via edit distance', () => {
    expect(resolveTranscriptSpeaker('rowam', users)?.id).toBe('u-rowan');
  });

  it('returns null for unknown or too short names', () => {
    expect(resolveTranscriptSpeaker('Floh', users)).toBeNull();
    expect(resolveTranscriptSpeaker('Bob', users)).toBeNull();
  });
});

describe('resolveTranscriptDisplayLanguage', () => {
  it('prefers an explicit account language over Accept-Language', () => {
    expect(resolveTranscriptDisplayLanguage('de', 'en-US,en;q=0.9')).toBe('de');
    expect(resolveTranscriptDisplayLanguage('en', 'de-DE,de;q=0.9')).toBe('en');
  });

  it('normalizes automatic account selection from Accept-Language', () => {
    expect(resolveTranscriptDisplayLanguage(null, 'en-US,en;q=0.9')).toBe('en');
    expect(resolveTranscriptDisplayLanguage(null, 'fr-FR,de-DE;q=0.8')).toBe('de');
    expect(resolveTranscriptDisplayLanguage(null, 'de;q=0.2,en;q=0.9')).toBe('en');
  });

  it('falls back to German for missing or unsupported preferences', () => {
    expect(resolveTranscriptDisplayLanguage(null, undefined)).toBe('de');
    expect(resolveTranscriptDisplayLanguage(null, 'fr-FR')).toBe('de');
    expect(resolveTranscriptDisplayLanguage(null, 'en;q=0,fr;q=1')).toBe('de');
  });
});

describe('annotateTranscriptSpeakers', () => {
  it('replaces line-level speakers with character labels and marks the author', () => {
    const transcript = [
      '[10:00] Torvald: Die Arena liegt vor euch.',
      '[10:05] Neris: Ich betrete die Arena.',
      '[10:10] Rowan: Ich bleibe hier.',
    ].join('\n');
    const result = annotate(transcript, 'u-rowan');

    expect(result.transcript).toContain('[10:00] Spielleiter (Torvald): Die Arena liegt vor euch.');
    expect(result.transcript).toContain('[10:05] Ruvan (Neris): Ich betrete die Arena.');
    expect(result.transcript).toContain('[10:10] Ilvane (Rowan) (du): Ich bleibe hier.');
  });

  it('annotates hour-format timestamps', () => {
    const result = annotate('[01:05:00] Rowan: Ich bin noch da.', 'u-rowan');
    expect(result.transcript).toBe('[01:05:00] Ilvane (Rowan) (du): Ich bin noch da.');
  });

  it('matches the fuzzy nickname "Warden | Tovi"', () => {
    const result = annotate('[10:05] Warden | Tovi: Ich wette fünf Gold.');
    expect(result.transcript).toContain('[10:05] Bardwyn (Warden | Tovi): Ich wette fünf Gold.');
  });

  it('replaces Whisper attribution artifacts inside the text', () => {
    const transcript = [
      '[10:00] Torvald: Neris:"Du bist dran."',
      '[10:01] Neris: rowan:"Pass auf."',
      '[10:02] Torvald: Neris& Torvald & sagen wir es so.',
    ].join('\n');
    const result = annotate(transcript, 'u-rowan');

    expect(result.transcript).toContain(
      '[10:00] Spielleiter (Torvald): Ruvan (Neris):"Du bist dran."'
    );
    expect(result.transcript).toContain('[10:01] Ruvan (Neris): Ilvane (Rowan) (du):"Pass auf."');
    expect(result.transcript).toContain(
      '[10:02] Spielleiter (Torvald): Ruvan (Neris)& Spielleiter (Torvald) & sagen wir es so.'
    );
  });

  it('replaces trailing ampersand chain artifacts (e.g. Torvald & Neris)', () => {
    const transcript = '[04:26] Neris: Torvald & Neris Ja. Ah, so rum';
    const result = annotate(transcript);
    expect(result.transcript).toBe(
      '[04:26] Ruvan (Neris): Spielleiter (Torvald) & Ruvan (Neris) Ja. Ah, so rum'
    );
  });

  it('handles ampersand chains with various spacing', () => {
    const cases: [string, string][] = [
      [
        '[10:00] Torvald: Torvald & Neris Ja',
        '[10:00] Spielleiter (Torvald): Spielleiter (Torvald) & Ruvan (Neris) Ja',
      ],
      [
        '[10:00] Torvald: Torvald&Neris Ja',
        '[10:00] Spielleiter (Torvald): Spielleiter (Torvald)&Ruvan (Neris) Ja',
      ],
      [
        '[10:00] Torvald: Neris& Torvald & Neris Ja',
        '[10:00] Spielleiter (Torvald): Ruvan (Neris)& Spielleiter (Torvald) & Ruvan (Neris) Ja',
      ],
    ];
    for (const [input, expected] of cases) {
      expect(annotate(input).transcript).toBe(expected);
    }
  });

  it('leaves unknown speakers and normal speech mentions unchanged', () => {
    const transcript = '[10:00] Floh: Neris ist ein Goliath. Ruvan ist auch da.';
    const result = annotate(transcript, 'u-rowan');
    expect(result.transcript).toBe(transcript);
  });

  it('keeps players without a character label unchanged', () => {
    const result = annotate('[10:00] Pell: Hallo zusammen.');
    expect(result.transcript).toBe('[10:00] Pell: Hallo zusammen.');
  });

  it('builds mapping lines for the prompt', () => {
    const transcript = [
      '[10:00] Torvald: Los.',
      '[10:01] Neris: Ich gehe.',
      '[10:02] Rowan: Ich auch.',
      '[10:03] Warden | Tovi: Warten.',
      '[10:04] Kestrel: Nee.',
      '[10:05] Pell: Hallo.',
    ].join('\n');
    const result = annotate(transcript, 'u-rowan');

    expect(result.mappingLines).toEqual([
      '- Torvald → Spielleiter (DM, kein Charakter)',
      '- Neris → Ruvan',
      '- Rowan → Ilvane (dein Charakter)',
      '- Warden | Tovi → Bardwyn',
      '- Kestrel → Aldric',
      '- Pell → keinem Charakter zugeordnet',
    ]);
  });
});
