// Whiteboard persistence and permission logic.
//
// The board is one shared infinite canvas per installation. Elements in the
// 'public' zone are visible and editable by every approved user; 'private'
// elements are only visible to their owner. All mutations go through the
// sanitizers below before they reach SQLite so malformed socket payloads can
// never inject unexpected fields or values.

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  User,
  WhiteboardElement,
  WhiteboardElementType,
  WhiteboardPatch,
  WhiteboardShapeKind,
  WhiteboardTaskStatus,
  WhiteboardZone,
} from '../shared/types.js';
import { db } from './database.js';
import { getEnv } from './env.js';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Directory where pasted/uploaded board images are stored. */
export function getWhiteboardUploadDir(): string {
  return getEnv().WHITEBOARD_UPLOAD_DIR;
}

export function ensureWhiteboardUploadDir(): string {
  const dir = getWhiteboardUploadDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

const ELEMENT_TYPES: readonly WhiteboardElementType[] = [
  'note',
  'task',
  'arrow',
  'link',
  'shape',
  'stroke',
];
const SHAPE_KINDS: readonly WhiteboardShapeKind[] = ['rect', 'ellipse', 'triangle', 'diamond'];
const TASK_STATUSES: readonly WhiteboardTaskStatus[] = ['open', 'in_progress', 'done'];
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const HTTP_URL_RE = /^https?:\/\/\S+$/i;
// Internal upload targets served by the authenticated static route.
const UPLOAD_URL_RE = /^\/uploads\/whiteboard\/[A-Za-z0-9._-]+$/;

const MAX_TEXT = 500;
const MAX_DESCRIPTION = 2000;
const MAX_URL = 2048;
const MAX_COORD = 1_000_000;
const MIN_SIZE = 60;
const MAX_SIZE = 4000;
const MIN_STROKE_WIDTH = 1;
const MAX_STROKE_WIDTH = 64;
/** Upper bound of stored freehand points; extra input points are dropped. */
const MAX_POINTS = 4000;

interface ElementRow {
  id: string;
  type: string;
  zone: string;
  owner_id: string;
  owner_name: string;
  x: number;
  y: number;
  x2: number | null;
  y2: number | null;
  width: number;
  height: number;
  color: string;
  text: string;
  description: string | null;
  status: string | null;
  url: string | null;
  from_id: string | null;
  to_id: string | null;
  shape_kind: string | null;
  fill_color: string | null;
  stroke_width: number;
  points: string | null;
  locked: number;
  created_at: string;
  updated_at: string;
}

/** Parses the stored JSON point list back into normalized pairs. */
function parsePoints(value: string | null): [number, number][] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const pairs: [number, number][] = [];
    for (let i = 0; i + 1 < parsed.length; i += 2) {
      const x = parsed[i];
      const y = parsed[i + 1];
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      pairs.push([x, y]);
    }
    return pairs.length > 0 ? pairs : null;
  } catch {
    return null;
  }
}

function rowToElement(row: ElementRow): WhiteboardElement {
  return {
    id: row.id,
    type: row.type as WhiteboardElementType,
    zone: row.zone as WhiteboardZone,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    x: row.x,
    y: row.y,
    x2: row.x2,
    y2: row.y2,
    width: row.width,
    height: row.height,
    color: row.color,
    text: row.text,
    description: row.description,
    status: row.status as WhiteboardTaskStatus | null,
    url: row.url,
    fromId: row.from_id,
    toId: row.to_id,
    shapeKind: row.shape_kind as WhiteboardShapeKind | null,
    fillColor: row.fill_color,
    strokeWidth: row.stroke_width,
    points: parsePoints(row.points),
    locked: !!row.locked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Sanitizers (pure)
// ---------------------------------------------------------------------------

export class WhiteboardError extends Error {}

export function visibleTo(element: WhiteboardElement, user: Pick<User, 'id'>): boolean {
  return element.zone === 'public' || element.ownerId === user.id;
}

export function canEditElement(element: WhiteboardElement, user: Pick<User, 'id'>): boolean {
  return visibleTo(element, user);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(-MAX_COORD, Math.min(MAX_COORD, value));
}

function asOptionalNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  const n = asNumber(value);
  return n === undefined ? undefined : n;
}

function asSize(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(value)));
}

function asText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.slice(0, max);
}

function asColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const hex = `#${value.replace(/[^0-9a-f]/gi, '').slice(0, 6)}`;
  return HEX_COLOR_RE.test(hex) ? hex.toLowerCase() : undefined;
}

function asUrl(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, MAX_URL);
  if (!trimmed) return null;
  if (!HTTP_URL_RE.test(trimmed) && !UPLOAD_URL_RE.test(trimmed)) {
    throw new WhiteboardError('Links müssen mit http(s) beginnen.');
  }
  return trimmed;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function asStrokeWidth(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(MIN_STROKE_WIDTH, Math.min(MAX_STROKE_WIDTH, value));
}

function asFillColor(value: unknown): string | null | undefined {
  if (value === null) return null;
  return asColor(value);
}

/**
 * Validates a freehand point list of [x, y] pairs with coordinates normalized
 * to the element box (0..1). Invalid entries are dropped and the list is
 * capped at MAX_POINTS.
 */
function asPoints(value: unknown): [number, number][] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const pairs: [number, number][] = [];
  for (const pair of value) {
    if (pairs.length >= MAX_POINTS) break;
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [x, y] = pair;
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const nx = Math.round(Math.min(1, Math.max(0, x)) * 10000) / 10000;
    const ny = Math.round(Math.min(1, Math.max(0, y)) * 10000) / 10000;
    pairs.push([nx, ny]);
  }
  return pairs.length > 0 ? pairs : null;
}

/** Serializes normalized stroke points for SQLite storage. */
function serializePoints(points: [number, number][] | null): string | null {
  return points ? JSON.stringify(points.flat()) : null;
}

/** Validates a full element payload coming from the client (create). */
export function sanitizeElementInput(
  input: unknown,
  user: Pick<User, 'id' | 'displayName'>
): WhiteboardElement {
  if (typeof input !== 'object' || input === null) {
    throw new WhiteboardError('Ungültiges Whiteboard-Element.');
  }
  const raw = input as Record<string, unknown>;
  const type = asEnum(raw.type, ELEMENT_TYPES);
  if (!type) throw new WhiteboardError('Unbekannter Element-Typ.');
  const zone = asEnum(raw.zone, ['public', 'private'] as const) ?? 'private';

  const now = new Date().toISOString();
  const element: WhiteboardElement = {
    id: typeof raw.id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(raw.id) ? raw.id : randomUUID(),
    type,
    zone,
    ownerId: user.id,
    ownerName: user.displayName,
    x: asNumber(raw.x) ?? 0,
    y: asNumber(raw.y) ?? 0,
    x2: asOptionalNumber(raw.x2) ?? null,
    y2: asOptionalNumber(raw.y2) ?? null,
    width: type === 'arrow' ? 0 : (asSize(raw.width) ?? (type === 'note' ? 200 : 260)),
    height: type === 'arrow' ? 0 : (asSize(raw.height) ?? (type === 'note' ? 150 : 180)),
    color: asColor(raw.color) ?? '#facc15',
    text: '',
    description: null,
    status: null,
    url: null,
    fromId: null,
    toId: null,
    shapeKind: null,
    fillColor: null,
    strokeWidth: 3,
    points: null,
    locked: false,
    createdAt: now,
    updatedAt: now,
  };

  applyPatch(element, sanitizePatch(raw));
  if (element.status && !TASK_STATUSES.includes(element.status)) element.status = null;
  // Shapes always render a concrete outline variant.
  if (element.type === 'shape' && !SHAPE_KINDS.includes(element.shapeKind as WhiteboardShapeKind)) {
    element.shapeKind = 'rect';
  }
  return element;
}

/** Validates a partial patch (update). Unknown or disallowed fields are dropped. */
export function sanitizePatch(patch: unknown): WhiteboardPatch {
  if (typeof patch !== 'object' || patch === null) return {};
  const raw = patch as Record<string, unknown>;
  const clean: WhiteboardPatch = {};

  const x = asNumber(raw.x);
  if (x !== undefined) clean.x = x;
  const y = asNumber(raw.y);
  if (y !== undefined) clean.y = y;
  const x2 = asOptionalNumber(raw.x2);
  if (x2 !== undefined) clean.x2 = x2;
  const y2 = asOptionalNumber(raw.y2);
  if (y2 !== undefined) clean.y2 = y2;
  const width = asSize(raw.width);
  if (width !== undefined) clean.width = width;
  const height = asSize(raw.height);
  if (height !== undefined) clean.height = height;
  const color = asColor(raw.color);
  if (color !== undefined) clean.color = color;
  const text = asText(raw.text, MAX_TEXT);
  if (text !== undefined) clean.text = text;
  const description = asText(raw.description, MAX_DESCRIPTION);
  if (description !== undefined) clean.description = description.trim() ? description : null;
  const status = asEnum(raw.status, TASK_STATUSES);
  if (status !== undefined) clean.status = status;
  else if (raw.status === null) clean.status = null;
  const url = asUrl(raw.url);
  if (url !== undefined) clean.url = url;
  const fromId = asReference(raw.fromId);
  if (fromId !== undefined) clean.fromId = fromId;
  const toId = asReference(raw.toId);
  if (toId !== undefined) clean.toId = toId;
  const shapeKind = asEnum(raw.shapeKind, SHAPE_KINDS);
  if (shapeKind !== undefined) clean.shapeKind = shapeKind;
  const fillColor = asFillColor(raw.fillColor);
  if (fillColor !== undefined) clean.fillColor = fillColor;
  const strokeWidth = asStrokeWidth(raw.strokeWidth);
  if (strokeWidth !== undefined) clean.strokeWidth = strokeWidth;
  const points = asPoints(raw.points);
  if (points !== undefined) clean.points = points;
  const zone = asEnum(raw.zone, ['public', 'private'] as const);
  if (zone !== undefined) clean.zone = zone;
  if (typeof raw.locked === 'boolean') clean.locked = raw.locked;

  return clean;
}

function asReference(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return /^[a-zA-Z0-9_-]{8,64}$/.test(value) ? value : null;
}

/**
 * Applies a sanitized patch onto an element object in place. Type-specific
 * fields are ignored for elements of a different type.
 */
function applyPatch(element: WhiteboardElement, patch: WhiteboardPatch): void {
  if (patch.x !== undefined) element.x = patch.x;
  if (patch.y !== undefined) element.y = patch.y;
  if (patch.x2 !== undefined) element.x2 = element.type === 'arrow' ? patch.x2 : null;
  if (patch.y2 !== undefined) element.y2 = element.type === 'arrow' ? patch.y2 : null;
  if (patch.width !== undefined && element.type !== 'arrow') element.width = patch.width;
  if (patch.height !== undefined && element.type !== 'arrow') element.height = patch.height;
  if (patch.color !== undefined) element.color = patch.color;
  if (patch.text !== undefined) element.text = patch.text.trim() ? patch.text : '';
  if (patch.description !== undefined && element.type === 'task') {
    element.description = patch.description;
  }
  if (patch.status !== undefined && element.type === 'task') {
    element.status = patch.status;
  }
  if (patch.url !== undefined && element.type === 'link') {
    element.url = patch.url;
  }
  if (patch.fromId !== undefined && element.type === 'arrow') element.fromId = patch.fromId;
  if (patch.toId !== undefined && element.type === 'arrow') element.toId = patch.toId;
  if (patch.shapeKind !== undefined && element.type === 'shape') {
    element.shapeKind = patch.shapeKind;
  }
  if (patch.fillColor !== undefined && element.type === 'shape') {
    element.fillColor = patch.fillColor;
  }
  if (patch.strokeWidth !== undefined && (element.type === 'shape' || element.type === 'stroke')) {
    element.strokeWidth = patch.strokeWidth;
  }
  if (patch.points !== undefined && element.type === 'stroke') {
    element.points = patch.points;
  }
  if (patch.locked !== undefined) element.locked = patch.locked;
  if (patch.zone !== undefined) element.zone = patch.zone;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function insertElement(element: WhiteboardElement): void {
  db.prepare(
    `INSERT INTO whiteboard_elements
       (id, type, zone, owner_id, owner_name, x, y, x2, y2, width, height,
        color, text, description, status, url, from_id, to_id,
        shape_kind, fill_color, stroke_width, points, locked, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    element.id,
    element.type,
    element.zone,
    element.ownerId,
    element.ownerName,
    element.x,
    element.y,
    element.x2,
    element.y2,
    element.width,
    element.height,
    element.color,
    element.text,
    element.description,
    element.status,
    element.url,
    element.fromId,
    element.toId,
    element.shapeKind,
    element.fillColor,
    element.strokeWidth,
    serializePoints(element.points),
    element.locked ? 1 : 0,
    element.createdAt,
    element.updatedAt
  );
}

export function listElementsForUser(user: Pick<User, 'id'>): WhiteboardElement[] {
  const rows = db
    .prepare(
      `SELECT * FROM whiteboard_elements WHERE zone = 'public' OR owner_id = ?
       ORDER BY created_at, id`
    )
    .all(user.id) as ElementRow[];
  return rows.map(rowToElement);
}

export function getElement(id: string): WhiteboardElement | null {
  const row = db.prepare('SELECT * FROM whiteboard_elements WHERE id = ?').get(id) as
    ElementRow | undefined;
  return row ? rowToElement(row) : null;
}

export function createElement(input: unknown, user: User): WhiteboardElement {
  const element = sanitizeElementInput(input, user);
  // Drop dangling anchor references up front.
  if (element.type === 'arrow') {
    if (!element.fromId || !getElement(element.fromId)) element.fromId = null;
    if (!element.toId || !getElement(element.toId)) element.toId = null;
  }
  db.transaction(() => insertElement(element))();
  return element;
}

export function updateElement(id: string, patch: unknown, user: User): WhiteboardElement {
  const existing = getElement(id);
  if (!existing) throw new WhiteboardError('Element nicht gefunden.');
  if (!canEditElement(existing, user)) throw new WhiteboardError('Keine Berechtigung.');

  const next = { ...existing };
  applyPatch(next, sanitizePatch(patch));
  // Dragging someone else's public element into the private zone claims it.
  if (next.zone === 'private' && existing.zone === 'public' && next.ownerId !== user.id) {
    next.ownerId = user.id;
    next.ownerName = user.displayName;
  }
  next.updatedAt = new Date().toISOString();

  // Clear anchors that point at deleted elements.
  if (next.type === 'arrow') {
    if (next.fromId && !getElement(next.fromId)) next.fromId = null;
    if (next.toId && !getElement(next.toId)) next.toId = null;
  }

  db.prepare(
    `UPDATE whiteboard_elements SET
       owner_id = ?, owner_name = ?, x = ?, y = ?, x2 = ?, y2 = ?, width = ?, height = ?, color = ?, text = ?,
       description = ?, status = ?, url = ?, from_id = ?, to_id = ?,
       shape_kind = ?, fill_color = ?, stroke_width = ?, points = ?, locked = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    next.ownerId,
    next.ownerName,
    next.x,
    next.y,
    next.x2,
    next.y2,
    next.width,
    next.height,
    next.color,
    next.text,
    next.description,
    next.status,
    next.url,
    next.fromId,
    next.toId,
    next.shapeKind,
    next.fillColor,
    next.strokeWidth,
    serializePoints(next.points),
    next.locked ? 1 : 0,
    next.updatedAt,
    id
  );
  return next;
}

export function removeElement(id: string, user: User): void {
  const existing = getElement(id);
  if (!existing) throw new WhiteboardError('Element nicht gefunden.');
  if (!canEditElement(existing, user)) throw new WhiteboardError('Keine Berechtigung.');
  db.transaction(() => {
    db.prepare('DELETE FROM whiteboard_elements WHERE id = ?').run(id);
    // Detach arrows that were anchored to this element.
    db.prepare('UPDATE whiteboard_elements SET from_id = NULL WHERE from_id = ?').run(id);
    db.prepare('UPDATE whiteboard_elements SET to_id = NULL WHERE to_id = ?').run(id);
  })();
}

// ---------------------------------------------------------------------------
// Realtime fan-out
// ---------------------------------------------------------------------------

function forEachVisibleSocket(
  io: IoServer,
  element: WhiteboardElement,
  fn: (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => void
): void {
  for (const socket of io.sockets.sockets.values()) {
    const socketUser = (socket as any).user as User | undefined;
    if (!socketUser) continue;
    if (!visibleTo(element, socketUser)) continue;
    fn(socket);
  }
}

export function broadcastWhiteboardUpsert(io: IoServer, element: WhiteboardElement): void {
  forEachVisibleSocket(io, element, (socket) => socket.emit('wbUpsert', element));
}

/**
 * Zone changes flip visibility: former viewers must drop the element while
 * new viewers receive it, so both sides get their matching event.
 */
export function broadcastWhiteboardZoneChange(
  io: IoServer,
  before: WhiteboardElement,
  after: WhiteboardElement
): void {
  for (const socket of io.sockets.sockets.values()) {
    const socketUser = (socket as any).user as User | undefined;
    if (!socketUser) continue;
    const wasVisible = visibleTo(before, socketUser);
    const isVisible = visibleTo(after, socketUser);
    if (isVisible) socket.emit('wbUpsert', after);
    else if (wasVisible) socket.emit('wbRemoved', after.id);
  }
}

export function broadcastWhiteboardRemoved(io: IoServer, id: string): void {
  io.emit('wbRemoved', id);
}
