import { getWhisperBootstrapLanguage } from '../ai/languageConfig.js';
import type { WhisperLanguage } from '../ai/promptLanguage.js';

export const LEGACY_WHISPER_INITIAL_PROMPT = 'This is a German D&D session with English terms.';

export const DEFAULT_WHISPER_INITIAL_PROMPTS: Readonly<Record<WhisperLanguage, string>> = {
  de: 'Dies ist eine deutsche D&D-Sitzung mit englischen Fachbegriffen.',
  en: 'This is an English D&D session with English terms.',
  auto: 'This is a D&D session.',
};

/**
 * Selects the context prompt for one transcription process. The old example
 * prompt is treated as unset so an existing installation cannot force German
 * context after the language setting changes. Other non-empty values remain
 * explicit operator overrides.
 */
export function getWhisperInitialPrompt(
  language: WhisperLanguage,
  configuredPrompt: string | undefined = process.env.WHISPER_INITIAL_PROMPT
): string {
  const configured = configuredPrompt?.trim();
  if (configured && configured !== LEGACY_WHISPER_INITIAL_PROMPT) return configuredPrompt!;
  return DEFAULT_WHISPER_INITIAL_PROMPTS[language];
}

export interface WhisperSpawnArgsOptions {
  script: string;
  model: string;
  language?: WhisperLanguage;
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
 * supplied, it reads the persisted global setting or the legacy bootstrap
 * fallback at call time.
 */
export function buildWhisperSpawnArgs(options: WhisperSpawnArgsOptions): string[] {
  const language = options.language ?? getWhisperBootstrapLanguage();
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
