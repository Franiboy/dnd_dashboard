import { afterEach, describe, expect, it } from 'vitest';
import { getAiSettings, setAiLanguageSettings } from '../repositories/aiSettings.js';
import {
  DEFAULT_WHISPER_INITIAL_PROMPTS,
  buildWhisperSpawnArgs,
  getWhisperInitialPrompt,
  type WhisperSpawnArgsOptions,
} from './whisperArgs.js';

const originalPrompt = process.env.WHISPER_INITIAL_PROMPT;
const originalLanguage = getAiSettings().language;

const baseOptions: WhisperSpawnArgsOptions = {
  script: '/tmp/transcribe.py',
  model: 'base',
  fp16: false,
  trimStart: 0,
  trimEnd: Infinity,
  noiseReduce: true,
  vadMinSilence: 2,
  vadMinSpeech: 0.5,
  computeType: 'int8',
  conditionOnPrevious: true,
  filterNoSpeechProb: 0.9,
};

function getArgumentValue(args: string[], name: string): string {
  const index = args.indexOf(name);
  expect(index).toBeGreaterThanOrEqual(0);
  return args[index + 1];
}

afterEach(() => {
  if (originalPrompt === undefined) delete process.env.WHISPER_INITIAL_PROMPT;
  else process.env.WHISPER_INITIAL_PROMPT = originalPrompt;
  setAiLanguageSettings(originalLanguage);
});

describe('Whisper spawn arguments', () => {
  it('uses a German language and German context for a German process', () => {
    delete process.env.WHISPER_INITIAL_PROMPT;

    const args = buildWhisperSpawnArgs({ ...baseOptions, language: 'de' });

    expect(getArgumentValue(args, '--language')).toBe('de');
    expect(getArgumentValue(args, '--initial-prompt')).toBe(DEFAULT_WHISPER_INITIAL_PROMPTS.de);
  });

  it('uses an English language and English context for an English process', () => {
    delete process.env.WHISPER_INITIAL_PROMPT;

    const args = buildWhisperSpawnArgs({ ...baseOptions, language: 'en' });

    expect(getArgumentValue(args, '--language')).toBe('en');
    expect(getArgumentValue(args, '--initial-prompt')).toBe(DEFAULT_WHISPER_INITIAL_PROMPTS.en);
  });

  it('keeps an explicitly configured custom context prompt', () => {
    const customPrompt = 'Use the campaign names and the D&D rules reference.';
    process.env.WHISPER_INITIAL_PROMPT = customPrompt;

    const prompt = getWhisperInitialPrompt('en');
    const args = buildWhisperSpawnArgs({ ...baseOptions, language: 'en' });

    expect(prompt).toBe(customPrompt);
    expect(getArgumentValue(args, '--initial-prompt')).toBe(customPrompt);
  });

  it('reads the admin language again for each new process', () => {
    delete process.env.WHISPER_INITIAL_PROMPT;
    setAiLanguageSettings('de');
    const germanArgs = buildWhisperSpawnArgs(baseOptions);

    setAiLanguageSettings('en');
    const englishArgs = buildWhisperSpawnArgs(baseOptions);

    expect(getArgumentValue(germanArgs, '--language')).toBe('de');
    expect(getArgumentValue(englishArgs, '--language')).toBe('en');
  });
});
