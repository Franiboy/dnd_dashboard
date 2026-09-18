import { describe, expect, it } from 'vitest';
import {
  annotateTranscriptSpeakers,
  resolveTranscriptSpeaker,
  type SpeakerAnnotationResult,
} from './transcriptSpeakers.js';
import type { SafeUser } from '../../shared/types.js';

const users: SafeUser[] = [
  {
    id: 'u-franiboy',
    username: 'franiboy',
    displayName: 'Franiboy',
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
    id: 'u-cloudsenx',
    username: 'cloudsenx',
    displayName: 'Cloudsen',
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
    id: 'u-jogi',
    username: 'xvariance',
    displayName: 'xVariance / Jogi',
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
    id: 'u-arch',
    username: 'archerymaister',
    displayName: 'Archerymaister',
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
    id: 'u-nils',
    username: 'lauchboy125',
    displayName: 'Nils',
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
    id: 'u-lykros',
    username: 'lykros_',
    displayName: 'Lykros',
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
    expect(resolveTranscriptSpeaker('Cloudsen', users)?.id).toBe('u-cloudsenx');
  });

  it('matches the username as fallback', () => {
    expect(resolveTranscriptSpeaker('cloudsenx', users)?.id).toBe('u-cloudsenx');
  });

  it('matches server nicknames via normalized containment', () => {
    expect(resolveTranscriptSpeaker('Variance | Jogi', users)?.id).toBe('u-jogi');
  });

  it('matches near-identical transcription typos via edit distance', () => {
    expect(resolveTranscriptSpeaker('franipoy', users)?.id).toBe('u-franiboy');
  });

  it('returns null for unknown or too short names', () => {
    expect(resolveTranscriptSpeaker('Floh', users)).toBeNull();
    expect(resolveTranscriptSpeaker('Bob', users)).toBeNull();
  });
});

describe('annotateTranscriptSpeakers', () => {
  it('replaces line-level speakers with character labels and marks the author', () => {
    const transcript = [
      '[10:00] Nils: Die Arena liegt vor euch.',
      '[10:05] Cloudsen: Ich betrete die Arena.',
      '[10:10] Franiboy: Ich bleibe hier.',
    ].join('\n');
    const result = annotate(transcript, 'u-franiboy');

    expect(result.transcript).toContain('[10:00] Spielleiter (Nils): Die Arena liegt vor euch.');
    expect(result.transcript).toContain('[10:05] Vimak (Cloudsen): Ich betrete die Arena.');
    expect(result.transcript).toContain('[10:10] Calzone (Franiboy) (du): Ich bleibe hier.');
  });

  it('annotates hour-format timestamps', () => {
    const result = annotate('[01:05:00] Franiboy: Ich bin noch da.', 'u-franiboy');
    expect(result.transcript).toBe('[01:05:00] Calzone (Franiboy) (du): Ich bin noch da.');
  });

  it('matches the fuzzy nickname "Variance | Jogi"', () => {
    const result = annotate('[10:05] Variance | Jogi: Ich wette fünf Gold.');
    expect(result.transcript).toContain(
      '[10:05] Heinz-Hartmut (Variance | Jogi): Ich wette fünf Gold.'
    );
  });

  it('replaces Whisper attribution artifacts inside the text', () => {
    const transcript = [
      '[10:00] Nils: Cloudsen:"Du bist dran."',
      '[10:01] Cloudsen: franiboy:"Pass auf."',
      '[10:02] Nils: Cloudsen& Nils & sagen wir es so.',
    ].join('\n');
    const result = annotate(transcript, 'u-franiboy');

    expect(result.transcript).toContain(
      '[10:00] Spielleiter (Nils): Vimak (Cloudsen):"Du bist dran."'
    );
    expect(result.transcript).toContain(
      '[10:01] Vimak (Cloudsen): Calzone (Franiboy) (du):"Pass auf."'
    );
    expect(result.transcript).toContain(
      '[10:02] Spielleiter (Nils): Vimak (Cloudsen)& Spielleiter (Nils) & sagen wir es so.'
    );
  });

  it('replaces trailing ampersand chain artifacts (e.g. Nils & Cloudsen)', () => {
    const transcript = '[04:26] Cloudsen: Nils & Cloudsen Ja. Ah, so rum';
    const result = annotate(transcript);
    expect(result.transcript).toBe(
      '[04:26] Vimak (Cloudsen): Spielleiter (Nils) & Vimak (Cloudsen) Ja. Ah, so rum'
    );
  });

  it('handles ampersand chains with various spacing', () => {
    const cases: [string, string][] = [
      [
        '[10:00] Nils: Nils & Cloudsen Ja',
        '[10:00] Spielleiter (Nils): Spielleiter (Nils) & Vimak (Cloudsen) Ja',
      ],
      [
        '[10:00] Nils: Nils&Cloudsen Ja',
        '[10:00] Spielleiter (Nils): Spielleiter (Nils)&Vimak (Cloudsen) Ja',
      ],
      [
        '[10:00] Nils: Cloudsen& Nils & Cloudsen Ja',
        '[10:00] Spielleiter (Nils): Vimak (Cloudsen)& Spielleiter (Nils) & Vimak (Cloudsen) Ja',
      ],
    ];
    for (const [input, expected] of cases) {
      expect(annotate(input).transcript).toBe(expected);
    }
  });

  it('leaves unknown speakers and normal speech mentions unchanged', () => {
    const transcript = '[10:00] Floh: Cloudsen ist ein Goliath. Vimak ist auch da.';
    const result = annotate(transcript, 'u-franiboy');
    expect(result.transcript).toBe(transcript);
  });

  it('keeps players without a character label unchanged', () => {
    const result = annotate('[10:00] Lykros: Hallo zusammen.');
    expect(result.transcript).toBe('[10:00] Lykros: Hallo zusammen.');
  });

  it('builds mapping lines for the prompt', () => {
    const transcript = [
      '[10:00] Nils: Los.',
      '[10:01] Cloudsen: Ich gehe.',
      '[10:02] Franiboy: Ich auch.',
      '[10:03] Variance | Jogi: Warten.',
      '[10:04] Archerymaister: Nee.',
      '[10:05] Lykros: Hallo.',
    ].join('\n');
    const result = annotate(transcript, 'u-franiboy');

    expect(result.mappingLines).toEqual([
      '- Nils → Spielleiter (DM, kein Charakter)',
      '- Cloudsen → Vimak',
      '- Franiboy → Calzone (dein Charakter)',
      '- Variance | Jogi → Heinz-Hartmut',
      '- Archerymaister → Archybald',
      '- Lykros → keinem Charakter zugeordnet',
    ]);
  });
});
