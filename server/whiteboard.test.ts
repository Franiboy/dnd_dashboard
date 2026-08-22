import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { User, WhiteboardElement } from '../shared/types.js';
import {
  WhiteboardError,
  canEditElement,
  createElement,
  listElementsForUser,
  removeElement,
  sanitizePatch,
  updateElement,
  visibleTo,
} from './whiteboard.js';

// The test database persists between runs, so every run marks its rows with
// an exclusive prefix before asserting on filtered lists.
const RUN_PREFIX = `wbrun-${randomUUID().slice(0, 8)}`;

function testUser(id: string): User {
  return {
    id,
    username: id,
    displayName: `Display ${id}`,
    passwordHash: null,
    discordId: null,
    avatarUrl: null,
    isAdmin: false,
    isApproved: true,
    role: 'player',
    disabledApps: [],
    activePerson: null,
    autoSessionToDiary: false,
    autoAcceptSessionDiary: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date().toISOString(),
  };
}

function noteInput(overrides: Record<string, unknown> = {}) {
  return {
    type: 'note',
    zone: 'public',
    x: 10,
    y: -20,
    width: 220,
    height: 160,
    color: '#38bdf8',
    text: 'Hallo Board',
    ...overrides,
  };
}

describe('whiteboard visibility and permissions', () => {
  it('shows public elements to everyone but private ones only to the owner', () => {
    const alice = testUser('alice-user-1');
    const bob = testUser('bob-user-001');
    const publicNote = createElement(noteInput({ text: 'Visibility public' }), alice);
    const privateNote = createElement(
      noteInput({ zone: 'private', text: 'Visibility private' }),
      alice
    );

    expect(visibleTo(publicNote, alice)).toBe(true);
    expect(visibleTo(publicNote, bob)).toBe(true);
    expect(canEditElement(publicNote, bob)).toBe(true);
    expect(visibleTo(privateNote, bob)).toBe(false);
    expect(canEditElement(privateNote, bob)).toBe(false);
    expect(canEditElement(privateNote, alice)).toBe(true);
  });

  it('filters the stored element list per user', () => {
    const alice = testUser('alice-list-1');
    const bob = testUser('bob-list-001');
    createElement(noteInput({ text: `${RUN_PREFIX} public` }), alice);
    createElement(noteInput({ zone: 'private', text: `${RUN_PREFIX} alice-private` }), alice);
    createElement(noteInput({ zone: 'private', text: `${RUN_PREFIX} bob-private` }), bob);

    const forAlice = listElementsForUser(alice)
      .filter((e) => e.text.startsWith(RUN_PREFIX))
      .map((e) => e.text)
      .sort();
    const forBob = listElementsForUser(bob)
      .filter((e) => e.text.startsWith(RUN_PREFIX))
      .map((e) => e.text)
      .sort();
    // Each user sees all public elements plus their own private ones.
    expect(forAlice).toEqual([`${RUN_PREFIX} alice-private`, `${RUN_PREFIX} public`]);
    expect(forBob).toEqual([`${RUN_PREFIX} bob-private`, `${RUN_PREFIX} public`]);
  });
});

describe('whiteboard element lifecycle', () => {
  it('creates, updates and deletes elements with sanitized values', () => {
    const alice = testUser('alice-crud-1');
    const created = createElement(
      noteInput({
        id: 'short',
        color: 'not-a-color!',
        width: 999999,
        unknownField: 'dropped',
      }),
      alice
    );

    // Invalid client ids fall back to a generated uuid.
    expect(created.id).not.toBe('short');
    expect(created.ownerId).toBe(alice.id);
    expect(created.ownerName).toBe(alice.displayName);
    // Unsupported colors fall back to the default.
    expect(created.color).toBe('#facc15');
    expect(created.width).toBe(4000);

    const updated = updateElement(
      created.id,
      sanitizePatch({ text: 'Neuer Text', x: 42.7, height: -5 }),
      alice
    );
    expect(updated.text).toBe('Neuer Text');
    expect(updated.x).toBe(42.7);
    expect(updated.height).toBe(60);

    // Locking persists and round-trips through the list query.
    const locked = updateElement(created.id, sanitizePatch({ locked: true }), alice);
    expect(locked.locked).toBe(true);
    const stored = listElementsForUser(alice).find((e) => e.id === created.id)!;
    expect(stored.locked).toBe(true);
    const unlocked = updateElement(created.id, sanitizePatch({ locked: false }), alice);
    expect(unlocked.locked).toBe(false);

    removeElement(created.id, alice);
    expect(listElementsForUser(alice).find((e) => e.id === created.id)).toBeUndefined();
  });

  it('rejects updates and deletes from users without permission', () => {
    const alice = testUser('alice-perm-1');
    const bob = testUser('bob-perm-0001');
    const privateNote = createElement(noteInput({ zone: 'private' }), alice);

    expect(() => updateElement(privateNote.id, { text: 'gehackt' }, bob)).toThrow(WhiteboardError);
    expect(() => removeElement(privateNote.id, bob)).toThrow(WhiteboardError);
  });

  it('detaches arrow anchors when the referenced element is removed', () => {
    const alice = testUser('alice-arrow-1');
    const noteA = createElement(noteInput({ zone: 'private' }), alice);
    const noteB = createElement(noteInput({ zone: 'private' }), alice);
    const arrow = createElement(
      {
        type: 'arrow',
        zone: 'private',
        x: 0,
        y: 0,
        x2: 100,
        y2: 100,
        fromId: noteA.id,
        toId: noteB.id,
      },
      alice
    );
    expect(arrow.fromId).toBe(noteA.id);

    removeElement(noteB.id, alice);
    const after = listElementsForUser(alice).find((e) => e.id === arrow.id)! as WhiteboardElement;
    expect(after.toId).toBeNull();
    expect(after.fromId).toBe(noteA.id);
  });

  it('creates plain text elements with sanitized values', () => {
    const alice = testUser('alice-text-01');
    const created = createElement(
      {
        type: 'text',
        zone: 'public',
        x: 10,
        y: -30,
        width: 220,
        height: 120,
        color: '#ffffff',
        text: 'Hallo Text',
      },
      alice
    );
    expect(created.type).toBe('text');
    expect(created.text).toBe('Hallo Text');
    // Plain text elements carry no type-specific extras.
    expect(created.url).toBeNull();
    expect(created.status).toBeNull();
    const stored = listElementsForUser(alice).find((e) => e.id === created.id)!;
    expect(stored.type).toBe('text');
  });

  it('rejects non-http link urls and clamps oversized input', () => {
    const alice = testUser('alice-link-01');
    const link = createElement({ type: 'link', zone: 'public', x: 0, y: 0 }, alice);
    // Links are created without a target until a valid URL is set.
    expect(link.url).toBeNull();

    expect(() =>
      updateElement(link.id, sanitizePatch({ url: 'javascript:alert(1)' }), alice)
    ).toThrow(WhiteboardError);

    const good = updateElement(link.id, sanitizePatch({ url: 'https://example.com' }), alice);
    expect(good.url).toBe('https://example.com');

    const long = updateElement(link.id, sanitizePatch({ text: 'x'.repeat(501) }), alice);
    expect(long.text).toHaveLength(500);
  });

  it('sanitizes and persists the layer zIndex', () => {
    const alice = testUser('alice-z-00001');
    const created = createElement(noteInput({ zIndex: 7 }), alice);
    expect(created.zIndex).toBe(7);
    // Legacy payloads without a zIndex default to 0.
    expect(createElement(noteInput(), alice).zIndex).toBe(0);

    // Floats round, extremes clamp, invalid types are dropped entirely.
    expect(sanitizePatch({ zIndex: 3.6 })).toEqual({ zIndex: 4 });
    expect(sanitizePatch({ zIndex: 1e9 })).toEqual({ zIndex: 100_000 });
    expect(sanitizePatch({ zIndex: -1e9 })).toEqual({ zIndex: -100_000 });
    expect(sanitizePatch({ zIndex: '5' })).toEqual({});
    expect(sanitizePatch({ zIndex: Number.NaN })).toEqual({});

    const updated = updateElement(created.id, sanitizePatch({ zIndex: -3 }), alice);
    expect(updated.zIndex).toBe(-3);
    const stored = listElementsForUser(alice).find((e) => e.id === created.id)!;
    expect(stored.zIndex).toBe(-3);
  });
});
