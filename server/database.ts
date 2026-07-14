import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || 'dnd.db';
export const db = new Database(DB_PATH);
