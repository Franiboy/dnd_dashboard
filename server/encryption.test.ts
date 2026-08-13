import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, isEncryptionConfigured } from './encryption.js';

describe('encryption', () => {
  it('reports encryption as configured when a key is present', () => {
    expect(isEncryptionConfigured()).toBe(true);
  });

  it('can encrypt and decrypt a value', () => {
    const original = 'my secret discord token';
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(encrypted).toContain(':');
    expect(decrypt(encrypted)).toBe(original);
  });

  it('returns null for an invalid ciphertext', () => {
    expect(decrypt('not-a-valid-ciphertext')).toBeNull();
  });

  it('returns null for a ciphertext with a wrong structure', () => {
    expect(decrypt('a:b')).toBeNull();
  });
});
