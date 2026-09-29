import { afterEach, describe, expect, it } from 'vitest';
import { buildArcPromptLines } from './arcContext.js';
import { buildPrompt } from './bingoSuggestions.js';
import { personaLines } from './rewrite.js';
import { annotateTranscriptSpeakers } from './transcriptSpeakers.js';
import {
  getAiOutputLanguage,
  normalizeAiLanguage,
  normalizeWhisperLanguage,
} from './promptLanguage.js';
import type { SafeUser } from '../../shared/types.js';

const originalOutputLanguage = process.env.AI_OUTPUT_LANGUAGE;

afterEach(() => {
  if (originalOutputLanguage === undefined) delete process.env.AI_OUTPUT_LANGUAGE;
  else process.env.AI_OUTPUT_LANGUAGE = originalOutputLanguage;
});

describe('prompt language helpers', () => {
  it('builds complete English arc, persona, and Bingo prompt variants', () => {
    expect(buildArcPromptLines('The Shattered Crown', 2, 4, 'en')).toEqual([
      '',
      'Story arc: This task belongs to the story arc "The Shattered Crown" (game day 2–4).',
      '- Context queries (diary entries and session summaries) return content from this arc only. Other arcs are intentionally not visible.',
    ]);
    expect(personaLines('Ruvan', 'en')).toEqual([
      'Perspective:',
      '- This diary entry is written from the perspective of "Ruvan".',
      '- Write the text consistently in the first-person perspective of "Ruvan".',
      '- Use the tone, vocabulary, and knowledge that fit "Ruvan" without changing the supplied facts.',
    ]);

    const prompt = buildPrompt(2, '/tmp/transcripts.txt', 'batch-en', 'dm', 'en');
    expect(prompt).toContain('You are an assistant for a D&D Bingo game.');
    expect(prompt).toContain('Language rule: All content you generate must be written in English.');
    expect(prompt).toContain('Task: Create exactly 2 new Bingo tasks');
    expect(prompt).toContain('submit_bingo_suggestions');
    expect(prompt).toContain('caused by PLAYERS');
    expect(prompt).not.toContain('auf Deutsch');
    expect(prompt).not.toContain('deutsche Sätze');
  });

  it('localizes deterministic transcript speaker labels', () => {
    const users: SafeUser[] = [
      {
        id: 'dm',
        username: 'dm',
        displayName: 'Bram',
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
        id: 'player',
        username: 'nordwind',
        displayName: 'Nordwind',
        avatarUrl: null,
        isAdmin: false,
        isApproved: true,
        role: 'player',
        disabledApps: [],
        activePerson: 'Ruvan',
        autoSessionToDiary: false,
        autoAcceptSessionDiary: false,
        themePrimary: null,
        uiLanguage: null,
        isInitialAdmin: false,
      },
    ];

    const result = annotateTranscriptSpeakers(
      '[00:00] Bram: Welcome.\n[00:01] Nordwind: I enter.',
      users,
      'player',
      'en'
    );

    expect(result.transcript).toBe(
      '[00:00] Dungeon Master (Bram): Welcome.\n[00:01] Ruvan (Nordwind) (you): I enter.'
    );
    expect(result.mappingLines).toEqual([
      '- Bram → Dungeon Master (DM, not a character)',
      '- Nordwind → Ruvan (your character)',
    ]);
  });

  it('reads and normalizes the per-run environment language', () => {
    process.env.AI_OUTPUT_LANGUAGE = 'en';
    expect(getAiOutputLanguage()).toBe('en');
    process.env.AI_OUTPUT_LANGUAGE = 'fr';
    expect(getAiOutputLanguage()).toBe('de');
    expect(normalizeAiLanguage('en')).toBe('en');
    expect(normalizeAiLanguage(undefined)).toBe('de');
    expect(normalizeWhisperLanguage('auto')).toBe('auto');
    expect(normalizeWhisperLanguage('fr')).toBe('de');
  });
});
