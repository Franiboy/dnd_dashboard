import { describe, expect, it } from 'vitest';
import {
  getGenerationBatchSize,
  getRefillThreshold,
  getTargetPoolSize,
} from './bingoConfig.js';

describe('bingoConfig', () => {
  it('returns defaults when env variables are not set', () => {
    delete process.env.BINGO_SUGGESTION_TARGET;
    delete process.env.BINGO_SUGGESTION_THRESHOLD;
    delete process.env.BINGO_SUGGESTION_BATCH;

    expect(getTargetPoolSize()).toBe(20);
    expect(getRefillThreshold()).toBe(5);
    expect(getGenerationBatchSize()).toBe(15);
  });

  it('parses positive integers from env', () => {
    process.env.BINGO_SUGGESTION_TARGET = '50';
    process.env.BINGO_SUGGESTION_THRESHOLD = '10';
    process.env.BINGO_SUGGESTION_BATCH = '25';

    expect(getTargetPoolSize()).toBe(50);
    expect(getRefillThreshold()).toBe(10);
    expect(getGenerationBatchSize()).toBe(25);
  });

  it('falls back to defaults for invalid values', () => {
    process.env.BINGO_SUGGESTION_TARGET = 'not-a-number';
    process.env.BINGO_SUGGESTION_THRESHOLD = '-3';
    process.env.BINGO_SUGGESTION_BATCH = '3.5';

    expect(getTargetPoolSize()).toBe(20);
    expect(getRefillThreshold()).toBe(5);
    expect(getGenerationBatchSize()).toBe(15);
  });
});
