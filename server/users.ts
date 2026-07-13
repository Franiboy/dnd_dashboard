import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';
import type { SafeUser, User } from '../shared/types.js';

const db = new Database('dnd.db');

const SALT_ROUNDS = 10;

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_approved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

function rowToUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    isAdmin: !!row.is_admin,
    isApproved: !!row.is_approved,
    createdAt: row.created_at,
  };
}

export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    isApproved: user.isApproved,
  };
}

export function createUser(username: string, displayName: string, password: string): SafeUser {
  const id = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  db.prepare(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, username.trim().toLowerCase(), displayName.trim(), passwordHash, 0, 0, new Date().toISOString());
  return toSafeUser(rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
}

export function createAdminUser(username: string, displayName: string, password: string): SafeUser {
  const id = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  db.prepare(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, username.trim().toLowerCase(), displayName.trim(), passwordHash, 1, 1, new Date().toISOString());
  return toSafeUser(rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
}

export function findUserByUsername(username: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
  return row ? rowToUser(row) : null;
}

export function findUserById(id: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? rowToUser(row) : null;
}

export function verifyPassword(user: User, password: string): boolean {
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

export function deleteUser(id: string): boolean {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}

export function ensureAdminUser(): SafeUser | null {
  const admin = db.prepare('SELECT * FROM users WHERE is_admin = 1 LIMIT 1').get() as any;
  if (!admin) {
    console.log('Creating default admin user: admin / admin');
    return createAdminUser('admin', 'Admin', 'admin');
  }
  return toSafeUser(rowToUser(admin));
}
