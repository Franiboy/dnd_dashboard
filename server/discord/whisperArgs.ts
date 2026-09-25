import type { Language } from '../../shared/types.js';
import { getAiLanguage } from '../ai/languageConfig.js';

export const DEFAULT_WHISPER_INITIAL_PROMPTS: Readonly<Record<Language, string>> = {
  de: 'Dies ist eine deutsche D&D-Sitzung mit englischen Fachbegriffen.',
  en: 'This is an English D&D session with English terms.',
};

/**
 * Selects the context prompt for one transcription process. A non-empty
 * environment value is an explicit operator override; otherwise the prompt
 * follows the captured admin language.
 */
export function getWhisperInitialPrompt(
  language: Language,
  configuredPrompt: string | undefined = process.env.WHISPER_INITIAL_PROMPT
): string {
  if (configuredPrompt?.trim()) return configuredPrompt;
  return DEFAULT_WHISPER_INITIAL_PROMPTS[language];
}

export interface WhisperSpawnArgsOptions {
  script: string;
  model: string;
  language?: Language;
  fp16: boolean;
  trimStart: number;
  trimEnd: number;
  noiseReduce: boolean;
  vadMinSilence: number;
  vadMinSpeech: number;
  computeType: string;
  conditionOnPrevious: boolean;
  filterNoSpeechProb: number;
  initialPrompt?: string;
}

/**
 * Builds the complete argv for one faster-whisper process. When no language is
 * supplied, it reads the persisted global admin setting at call time.
 */
export function buildWhisperSpawnArgs(options: WhisperSpawnArgsOptions): string[] {
  const language = options.language ?? getAiLanguage();
  const args = [
    '--',
    options.script,
    '--manifest',
    '-',
    '--model',
    options.model,
    '--language',
    language,
    '--fp16',
    String(options.fp16),
    '--trim-start',
    String(options.trimStart),
    '--noise-reduce',
    String(options.noiseReduce),
    '--vad-min-silence',
    String(options.vadMinSilence),
    '--vad-min-speech',
    String(options.vadMinSpeech),
    '--compute-type',
    options.computeType,
    '--condition-on-previous',
    String(options.conditionOnPrevious),
    '--filter-no-speech-prob',
    String(options.filterNoSpeechProb),
  ];

  if (options.trimEnd !== Infinity) {
    args.push('--trim-end', String(options.trimEnd));
  }

  args.push('--initial-prompt', getWhisperInitialPrompt(language, options.initialPrompt));
  return args;
}
