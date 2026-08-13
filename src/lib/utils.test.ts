import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges class names and removes falsy values', () => {
    expect(cn('btn', 'btn-primary', false, null, undefined, 'extra')).toBe('btn btn-primary extra');
  });

  it('resolves tailwind conflicts', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});
