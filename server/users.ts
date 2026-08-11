import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import type { SafeUser, User } from '../shared/types.js';
import { db } from './database.js';
import { createLogger } from './logger.js';
import { decrypt, encrypt, isEncryptionConfigured } from './encryption.js';

const SALT_ROUNDS = 10;
const log = createLogger('users');
export const INITIAL_ADMIN_USERNAME = 'admin';

// Column list for user rows; avoid loading encrypted Discord token columns when they are not needed.
const USER_COLUMNS =
  'id, username, display_name, password_hash, discord_id, avatar_url, is_admin, is_approved, disabled_apps, active_person, auto_session_to_diary, auto_accept_session_diary, failed_login_attempts, locked_until, created_at';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function rowToUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash || null,
    discordId: row.discord_id || null,
    avatarUrl: row.avatar_url || null,
    isAdmin: !!row.is_admin,
    isApproved: !!row.is_approved,
    disabledApps: parseJsonArray(row.disabled_apps),
    activePerson: row.active_person || null,
    autoSessionToDiary: !!row.auto_session_to_diary,
    autoAcceptSessionDiary: !!row.auto_accept_session_diary,
    failedLoginAttempts: row.failed_login_attempts || 0,
    lockedUntil: row.locked_until || null,
    createdAt: row.created_at,
  };
}

export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    isAdmin: user.isAdmin,
    isApproved: user.isApproved,
    disabledApps: user.disabledApps,
    activePerson: user.activePerson,
    autoSessionToDiary: user.autoSessionToDiary,
    autoAcceptSessionDiary: user.autoAcceptSessionDiary,
    isInitialAdmin: isInitialAdmin(user),
  };
}

export function isInitialAdmin(user: { username: string }): boolean {
  return user.username === INITIAL_ADMIN_USERNAME;
}

function isLocked(user: User): boolean {
  if (!user.lockedUntil) return false;
  return new Date(user.lockedUntil) > new Date();
}

export function createDiscordUser(discordId: string, username: string, displayName: string, avatarUrl: string | null): SafeUser {
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO users (id, username, display_name, password_hash, discord_id, avatar_url, is_admin, is_approved, disabled_apps, failed_login_attempts, locked_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, username.trim().toLowerCase(), displayName.trim(), null, discordId, avatarUrl, 0, 0, '[]', 0, null, new Date().toISOString());
  return toSafeUser(rowToUser(db.prepare('SELECT ' + USER_COLUMNS + ' FROM users WHERE id = ?').get(id)));
}

export function createAdminUser(username: string, displayName: string, password: string): SafeUser {
  const id = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  db.prepare(
    'INSERT INTO users (id, username, display_name, password_hash, discord_id, avatar_url, is_admin, is_approved, disabled_apps, failed_login_attempts, locked_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, username.trim().toLowerCase(), displayName.trim(), passwordHash, null, null, 1, 1, '[]', 0, null, new Date().toISOString());
  return toSafeUser(rowToUser(db.prepare('SELECT ' + USER_COLUMNS + ' FROM users WHERE id = ?').get(id)));
}

export function updateUserPassword(id: string, password: string): SafeUser | null {
  const user = findUserById(id);
  if (!user) return null;
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  return toSafeUser(rowToUser(db.prepare('SELECT ' + USER_COLUMNS + ' FROM users WHERE id = ?').get(id))!);
}

export function findUserByUsername(username: string): User | null {
  const row = db.prepare('SELECT ' + USER_COLUMNS + ' FROM users WHERE username = ?').get(username.trim().toLowerCase());
  return row ? rowToUser(row) : null;
}

export function findUserByDiscordId(discordId: string): User | null {
  const row = db.prepare('SELECT ' + USER_COLUMNS + ' FROM users WHERE discord_id = ?').get(discordId);
  return row ? rowToUser(row) : null;
}

export function findUserById(id: string): User | null {
  const row = db.prepare('SELECT ' + USER_COLUMNS + ' FROM users WHERE id = ?').get(id);
  return row ? rowToUser(row) : null;
}

export function verifyPassword(user: User, password: string): boolean {
  if (!user.passwordHash) return false;
  return bcrypt.compareSync(password, user.passwordHash);
}

export function getAllUsers(): SafeUser[] {
  const rows = db.prepare('SELECT ' + USER_COLUMNS + ' FROM users ORDER BY created_at DESC').all() as any[];
  return rows.map((r) => toSafeUser(rowToUser(r)));
}

export function getUsersWithAutoSessionToDiary(): SafeUser[] {
  const rows = db
    .prepare('SELECT ' + USER_COLUMNS + ' FROM users WHERE auto_session_to_diary = 1 ORDER BY created_at DESC')
    .all() as any[];
  return rows.map((r) => toSafeUser(rowToUser(r)));
}

export function setUserApproved(id: string, approved: boolean): SafeUser | null {
  const user = findUserById(id);
  if (!user) return null;
  db.prepare('UPDATE users SET is_approved = ? WHERE id = ?').run(approved ? 1 : 0, id);
  return toSafeUser(rowToUser(db.prepare('SELECT ' + USER_COLUMNS + ' FROM users WHERE id = ?').get(id))!);
}

export function setUserAdmin(id: string, isAdmin: boolean): SafeUser | null {
  const user = findUserById(id);
  if (!user) return null;
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, id);
  return toSafeUser(rowToUser(db.prepare('SELECT ' + USER_COLUMNS + ' FROM users WHERE id = ?').get(id))!);
}

export function setUserDisabledApps(id: string, disabledApps: string[]): SafeUser | null {
  const user = findUserById(id);
  if (!user) return null;
  const value = JSON.stringify(disabledApps.map((app) => String(app)));
  db.prepare('UPDATE users SET disabled_apps = ? WHERE id = ?').run(value, id);
  return toSafeUser(rowToUser(db.prepare('SELECT ' + USER_COLUMNS + ' FROM users WHERE id = ?').get(id))!);
}

export function setUserActivePerson(id: string, personName: string | null): SafeUser | null {
  const user = findUserById(id);
  if (!user) return null;
  const normalized = personName && personName.trim() ? personName.trim() : null;
  db.prepare('UPDATE users SET active_person = ? WHERE id = ?').run(normalized, id);
  return toSafeUser(rowToUser(db.prepare('SELECT ' + USER_COLUMNS + ' FROM users WHERE id = ?').get(id))!);
}

export function setUserSessionDiarySettings(
  id: string,
  autoSessionToDiary: boolean,
  autoAcceptSessionDiary: boolean,
): SafeUser | null {
  const user = findUserById(id);
  if (!user) return null;
  db.prepare('UPDATE users SET auto_session_to_diary = ?, auto_accept_session_diary = ? WHERE id = ?').run(
    autoSessionToDiary ? 1 : 0,
    autoAcceptSessionDiary ? 1 : 0,
    id,
  );
  return toSafeUser(rowToUser(db.prepare('SELECT ' + USER_COLUMNS + ' FROM users WHERE id = ?').get(id))!);
}

export function updateDiscordProfile(id: string, displayName: string, avatarUrl: string | null): SafeUser | null {
  const user = findUserById(id);
  if (!user) return null;
  db.prepare('UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?').run(displayName.trim(), avatarUrl, id);
  return toSafeUser(rowToUser(db.prepare('SELECT ' + USER_COLUMNS + ' FROM users WHERE id = ?').get(id))!);
}

export interface DiscordTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
}

export function storeDiscordTokens(id: string, accessToken: string, refreshToken: string, expiresAt: Date): void {
  if (!isEncryptionConfigured()) {
    throw new Error('Cannot store Discord tokens: TOKEN_ENCRYPTION_KEY is not configured or invalid');
  }
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error('expiresAt is invalid');
  }

  const encryptedAccessToken = encrypt(accessToken);
  const encryptedRefreshToken = encrypt(refreshToken);

  db.prepare(
    'UPDATE users SET discord_access_token = ?, discord_refresh_token = ?, discord_token_expires_at = ? WHERE id = ?'
  ).run(encryptedAccessToken, encryptedRefreshToken, expiresAt.toISOString(), id);
}

export function getDiscordTokens(id: string): DiscordTokens | null {
  if (!isEncryptionConfigured()) return null;

  const row = db.prepare('SELECT discord_access_token, discord_refresh_token, discord_token_expires_at FROM users WHERE id = ?').get(id) as
    | { discord_access_token: string | null; discord_refresh_token: string | null; discord_token_expires_at: string | null }
    | undefined;
  if (!row || !row.discord_access_token || !row.discord_refresh_token) return null;

  const accessToken = decrypt(row.discord_access_token);
  const refreshToken = decrypt(row.discord_refresh_token);
  if (!accessToken || !refreshToken) return null;

  let expiresAt: Date | null = null;
  if (row.discord_token_expires_at) {
    const parsed = new Date(row.discord_token_expires_at);
    if (!Number.isNaN(parsed.getTime())) {
      expiresAt = parsed;
    }
  }

  return { accessToken, refreshToken, expiresAt };
}

export function clearDiscordTokens(id: string): void {
  db.prepare('UPDATE users SET discord_access_token = NULL, discord_refresh_token = NULL, discord_token_expires_at = NULL WHERE id = ?').run(id);
}

export function getUsersWithDiscordTokens(): { id: string; discordId: string }[] {
  const rows = db
    .prepare('SELECT id, discord_id FROM users WHERE discord_refresh_token IS NOT NULL AND discord_id IS NOT NULL')
    .all() as { id: string; discord_id: string }[];
  return rows.map((r) => ({ id: r.id, discordId: r.discord_id }));
}

export function deleteUser(id: string): boolean {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}

export function recordFailedLogin(user: User): void {
  // Do not extend an active lockout; once it expires, start a fresh attempt window.
  if (isLocked(user)) return;
  let attempts = user.failedLoginAttempts + 1;
  if (user.lockedUntil) {
    attempts = 1;
  }

  let lockedUntil: string | null = null;
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    const until = new Date();
    until.setMinutes(until.getMinutes() + LOCKOUT_MINUTES);
    lockedUntil = until.toISOString();
  }
  db.prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?').run(attempts, lockedUntil, user.id);
}

export function resetFailedLogins(user: User): void {
  db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
}

export function checkLoginAllowed(user: User): { allowed: true } | { allowed: false; reason: string } {
  if (isLocked(user)) {
    return { allowed: false, reason: `Account ist gesperrt bis ${new Date(user.lockedUntil!).toLocaleString('de-DE')}` };
  }
  return { allowed: true };
}

export function ensureAdminUser(): SafeUser | null {
  if (!ADMIN_PASSWORD) {
    log.error('Fehler: ADMIN_PASSWORD ist nicht gesetzt. Bitte .env.example nach .env kopieren und anpassen.');
    process.exit(1);
  }

  const existing = findUserByUsername(INITIAL_ADMIN_USERNAME);
  if (!existing) {
    log.info('Creating default admin user:', INITIAL_ADMIN_USERNAME);
    const created = createAdminUser(INITIAL_ADMIN_USERNAME, 'Admin', ADMIN_PASSWORD);
    return created;
  }

  const valid = verifyPassword(existing, ADMIN_PASSWORD);
  if (!valid) {
    log.info('Resetting admin password for:', INITIAL_ADMIN_USERNAME);
    updateUserPassword(existing.id, ADMIN_PASSWORD);
  }

  if (!existing.isApproved || !existing.isAdmin) {
    db.prepare('UPDATE users SET is_admin = 1, is_approved = 1 WHERE id = ?').run(existing.id);
  }

  resetFailedLogins(existing);

  const admin = findUserById(existing.id);
  return admin ? toSafeUser(admin) : null;
}
