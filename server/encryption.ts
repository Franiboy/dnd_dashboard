import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { createLogger } from './logger.js';

const log = createLogger('encryption');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;

function decodeKey(raw: string): Buffer {
  // TOKEN_ENCRYPTION_KEY should be a base64-encoded 32-byte secret,
  // e.g. the output of `openssl rand -base64 32`.
  const trimmed = raw.trim();
  const key = Buffer.from(trimmed, 'base64');
  // Re-encoding catches invalid or base64url characters that were silently ignored.
  if (key.toString('base64') !== trimmed || key.length !== KEY_LENGTH) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be a valid base64-encoded ${KEY_LENGTH}-byte key. ` +
        'Generate it with: openssl rand -base64 32'
    );
  }
  return key;
}

export function isEncryptionConfigured(): boolean {
  if (cachedKey) return true;
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return false;
  try {
    cachedKey = decodeKey(raw);
    return true;
  } catch {
    return false;
  }
}

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not configured');
  }
  cachedKey = decodeKey(raw);
  return cachedKey;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decrypt(ciphertext: string): string | null {
  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) return null;

    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const data = Buffer.from(dataB64, 'base64url');

    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) return null;

    const key = getKey();
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    log.warn('Failed to decrypt token:', err);
    return null;
  }
}
