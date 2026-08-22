import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./opencode.js', () => ({
  runOpenCode: vi.fn(),
  deleteOpenCodeSession: vi.fn().mockResolvedValue(undefined),
}));

import { deleteOpenCodeSession, runOpenCode } from './opencode.js';
import { generateBingoSuggestionBatch } from './bingoSuggestions.js';
import {
  getBingoSuggestionBatch,
  submitBingoSuggestionBatch,
} from '../repositories/bingoSuggestions.js';
import type { TaskAudience } from '../../shared/types.js';
import type { OpenCodeResult } from './opencode.js';

const runOpenCodeMock = vi.mocked(runOpenCode);

const AUDIENCE: TaskAudience = 'dm';
const SUGGESTIONS = [
  'Ein Spieler kämpft vor Sessionstart mit Technik',
  'Jemand prahlt mit seinem neuen Würfelset',
];

let lastBatchId = '';

function extractBatchId(prompt: string): string {
  const match = prompt.match(/Deine Batch-ID ist "([^"]+)"/);
  if (!match) throw new Error('Prompt enthält keine Batch-ID');
  return match[1];
}

function submittedResults(): { text: string; source: 'ai' }[] {
  return SUGGESTIONS.map((text) => ({ text, source: 'ai' as const }));
}

function failureResult(exitCode: number): OpenCodeResult {
  return { success: false, output: 'crash', exitCode, sessionId: null };
}

describe('generateBingoSuggestionBatch', () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = 'opencode';
    process.env.AI_MODEL = 'test-model';
    lastBatchId = '';
    runOpenCodeMock.mockReset();
    vi.mocked(deleteOpenCodeSession).mockClear();
  });

  it('keeps submitted results when the CLI exits non-zero after a successful submit', async () => {
    runOpenCodeMock.mockImplementation(async ({ prompt }) => {
      lastBatchId = extractBatchId(prompt);
      // Der Agent übergibt den Batch erfolgreich, die CLI stürzt danach ab.
      submitBingoSuggestionBatch(lastBatchId, submittedResults());
      return failureResult(1);
    });

    const result = await generateBingoSuggestionBatch(SUGGESTIONS.length, AUDIENCE);

    expect(result).toEqual(SUGGESTIONS);
    expect(getBingoSuggestionBatch(lastBatchId)?.status).toBe('completed');
  });

  it('marks the batch as failed when the CLI exits non-zero without submitting', async () => {
    runOpenCodeMock.mockImplementation(async ({ prompt }) => {
      lastBatchId = extractBatchId(prompt);
      return failureResult(130);
    });

    const result = await generateBingoSuggestionBatch(SUGGESTIONS.length, AUDIENCE);

    expect(result).toEqual([]);
    expect(getBingoSuggestionBatch(lastBatchId)?.status).toBe('failed');
  });

  it('returns submitted results on the normal success path', async () => {
    runOpenCodeMock.mockImplementation(async ({ prompt }) => {
      lastBatchId = extractBatchId(prompt);
      submitBingoSuggestionBatch(lastBatchId, submittedResults());
      return { success: true, output: 'done', exitCode: 0, sessionId: 'ses_test' };
    });

    const result = await generateBingoSuggestionBatch(SUGGESTIONS.length, AUDIENCE);

    expect(result).toEqual(SUGGESTIONS);
    expect(getBingoSuggestionBatch(lastBatchId)?.status).toBe('completed');
    expect(deleteOpenCodeSession).toHaveBeenCalledWith('ses_test');
  });
});
