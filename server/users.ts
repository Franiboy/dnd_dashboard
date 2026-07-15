import bcrypt from 'bcrypt';
import type { SafeUser, User } from '../shared/types.js';
import { db } from './database.js';

const SALT_ROUNDS = 10;
export const INITIAL_ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

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
    canAccessPreviews: !!row.can_access_previews,
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
    canAccessPreviews: user.canAccessPreviews,
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
    'INSERT INTO users (id, username, display_name, password_hash, discord_id, avatar_url, is_admin, is_approved, can_access_previews, failed_login_attempts, locked_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, username.trim().toLowerCase(), displayName.trim(), null, discordId, avatarUrl, 0, 0, 0, 0, null, new Date().toISOString());
  return toSafeUser(rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
}

export function createAdminUser(username: string, displayName: string, password: string): SafeUser {
  const id = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  db.prepare(
    'INSERT INTO users (id, username, display_name, password_hash, discord_id, avatar_url, is_admin, is_approved, can_access_previews, failed_login_attempts, locked_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, username.trim().toLowerCase(), displayName.trim(), passwordHash, null, null, 1, 1, 0, 0, null, new Date().toISOString());
  return toSafeUser(rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
}

export function updateUserPassword(id: string, password: string): SafeUser | null {
  const user = findUserById(id);
  if (!user) return null;
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  return toSafeUser(rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))!);
}

export function findUserByUsername(username: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
  return row ? rowToUser(row) : null;
}

export function findUserByDiscordId(discordId: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId);
  return row ? rowToUser(row) : null;
}

export function findUserById(id: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? rowToUser(row) : null;
}

export function verifyPassword(user: User, password: string): boolean {
  if (!user.passwordHash) return false;
  return bcrypt.compareSync(password, user.passwordHash);
}

export function getAllUsers(): SafeUser[] {
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as any[];
  return rows.map((r) => toSafeUser(rowToUser(r)));
}

export function setUserApproved(id: string, approved: boolean): SafeUser | null {
  const user = findUserById(id);
  if (!user) return null;
  db.prepare('UPDATE users SET is_approved = ? WHERE id = ?').run(approved ? 1 : 0, id);
  return toSafeUser(rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))!);
}

export function setUserAdmin(id: string, isAdmin: boolean): SafeUser | null {
  const user = findUserById(id);
  if (!user) return null;
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, id);
  return toSafeUser(rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))!);
}

export function setUserPreviewAccess(id: string, canAccessPreviews: boolean): SafeUser | null {
  const user = findUserById(id);
  if (!user) return null;
  db.prepare('UPDATE users SET can_access_previews = ? WHERE id = ?').run(canAccessPreviews ? 1 : 0, id);
  return toSafeUser(rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))!);
}

export function updateDiscordProfile(id: string, displayName: string, avatarUrl: string | null): SafeUser | null {
  const user = findUserById(id);
  if (!user) return null;
  db.prepare('UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?').run(displayName.trim(), avatarUrl, id);
  return toSafeUser(rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))!);
}

export function deleteUser(id: string): boolean {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}

export function recordFailedLogin(user: User): void {
  const attempts = user.failedLoginAttempts + 1;
  let lockedUntil: string | null = user.lockedUntil;
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
    console.error('Fehler: ADMIN_PASSWORD ist nicht gesetzt. Bitte .env.example nach .env kopieren und anpassen.');
    process.exit(1);
  }

  const existing = findUserByUsername(INITIAL_ADMIN_USERNAME);
  if (!existing) {
    console.log('Creating default admin user:', INITIAL_ADMIN_USERNAME);
    const created = createAdminUser(INITIAL_ADMIN_USERNAME, 'Admin', ADMIN_PASSWORD);
    return created;
  }

  const valid = verifyPassword(existing, ADMIN_PASSWORD);
  if (!valid) {
    console.log('Resetting admin password for:', INITIAL_ADMIN_USERNAME);
    updateUserPassword(existing.id, ADMIN_PASSWORD);
  }

  if (!existing.isApproved || !existing.isAdmin) {
    db.prepare('UPDATE users SET is_admin = 1, is_approved = 1 WHERE id = ?').run(existing.id);
  }

  resetFailedLogins(existing);

  const admin = findUserById(existing.id);
  return admin ? toSafeUser(admin) : null;
}
