import type {
  User,
  WhiteboardElement,
  WhiteboardElementType,
  WhiteboardShapeKind,
  WhiteboardTaskStatus,
  WhiteboardZone,
} from '../../shared/types.js';
import { db } from '../database.js';

/**
 * SQLite persistence for whiteboard elements: row mapping and prepared
 * statements only. Permissions, sanitization and realtime fan-out live in
 * `server/whiteboard.ts` on top of this module.
 */

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
  z_index: number;
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
    zIndex: row.z_index ?? 0,
    locked: !!row.locked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Sanitizers (pure)
// ---------------------------------------------------------------------------

export class WhiteboardError extends Error {}

function serializePoints(points: [number, number][] | null): string | null {
  return points ? JSON.stringify(points.flat()) : null;
}

/** Validates a full element payload coming from the client (create). */

// Hot-path statements are prepared once at module level; better-sqlite3
// re-preparing per call would dominate the cost of the socket write path.
export const insertElementStmt = db.prepare(
  `INSERT INTO whiteboard_elements
     (id, type, zone, owner_id, owner_name, x, y, x2, y2, width, height,
      color, text, description, status, url, from_id, to_id,
      shape_kind, fill_color, stroke_width, points, z_index,
      locked, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

export function insertElement(element: WhiteboardElement): void {
  insertElementStmt.run(
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
    element.zIndex,
    element.locked ? 1 : 0,
    element.createdAt,
    element.updatedAt
  );
}

const listElementsStmt = db.prepare(
  `SELECT * FROM whiteboard_elements WHERE zone = 'public' OR owner_id = ?
   ORDER BY created_at, id`
);

const selectElementStmt = db.prepare('SELECT * FROM whiteboard_elements WHERE id = ?');

export function listElementsForUser(user: Pick<User, 'id'>): WhiteboardElement[] {
  const rows = listElementsStmt.all(user.id) as ElementRow[];
  return rows.map(rowToElement);
}

export function getElement(id: string): WhiteboardElement | null {
  const row = selectElementStmt.get(id) as ElementRow | undefined;
  return row ? rowToElement(row) : null;
}

const updateElementStmt = db.prepare(
  `UPDATE whiteboard_elements SET
     owner_id = ?, owner_name = ?, x = ?, y = ?, x2 = ?, y2 = ?, width = ?, height = ?, color = ?, text = ?,
     description = ?, status = ?, url = ?, from_id = ?, to_id = ?,
     shape_kind = ?, fill_color = ?, stroke_width = ?, points = ?, z_index = ?,
     locked = ?, updated_at = ?
   WHERE id = ?`
);

const deleteElementStmt = db.prepare('DELETE FROM whiteboard_elements WHERE id = ?');
const detachFromStmt = db.prepare(
  'UPDATE whiteboard_elements SET from_id = NULL WHERE from_id = ?'
);
const detachToStmt = db.prepare('UPDATE whiteboard_elements SET to_id = NULL WHERE to_id = ?');
const countUrlStmt = db.prepare('SELECT COUNT(*) AS n FROM whiteboard_elements WHERE url = ?');

export function updateElementRow(element: WhiteboardElement): void {
  updateElementStmt.run(
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
    element.zIndex,
    element.locked ? 1 : 0,
    element.updatedAt,
    element.id
  );
}

/** Number of elements referencing the given (upload) URL. */
export function countElementsReferencingUrl(url: string): number {
  const row = countUrlStmt.get(url) as { n: number };
  return row.n;
}

/** Deletes the element row and detaches arrows anchored to it. */
export function deleteElementRow(id: string): void {
  db.transaction(() => {
    deleteElementStmt.run(id);
    detachFromStmt.run(id);
    detachToStmt.run(id);
  })();
}
