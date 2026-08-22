import { describe, expect, it } from 'vitest';
import type { WhiteboardElement } from '../../../shared/types';
import {
  buildStrokeGeometry,
  compareStackOrder,
  isShapeTool,
  layerMovePatches,
  nextTopZIndex,
  shapeKindForTool,
} from './whiteboardShared';

function element(overrides: Partial<WhiteboardElement> & { id: string }): WhiteboardElement {
  return {
    type: 'note',
    zone: 'public',
    ownerId: 'owner',
    ownerName: 'Owner',
    x: 0,
    y: 0,
    x2: null,
    y2: null,
    width: 200,
    height: 150,
    color: '#facc15',
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
    zIndex: 0,
    locked: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function stack(): WhiteboardElement[] {
  return [
    element({ id: 'bottom', zIndex: 0 }),
    element({ id: 'middle', zIndex: 5, createdAt: '2026-01-02T00:00:00.000Z' }),
    element({ id: 'top', zIndex: 9, createdAt: '2026-01-03T00:00:00.000Z' }),
    // Arrows never participate in the stack.
    element({ id: 'arrow', type: 'arrow', zIndex: 100, createdAt: '2026-01-04T00:00:00.000Z' }),
  ];
}

describe('compareStackOrder', () => {
  it('sorts by zIndex with deterministic creation-order tiebreak', () => {
    const a = element({ id: 'a', zIndex: 1, createdAt: '2026-01-02T00:00:00.000Z' });
    const b = element({ id: 'b', zIndex: 1, createdAt: '2026-01-01T00:00:00.000Z' });
    expect([a, b].sort(compareStackOrder).map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('layerMovePatches', () => {
  it('swaps distinct zIndex values when moving forward and backward', () => {
    expect(layerMovePatches(stack(), 'middle', 'forward')).toEqual([
      { id: 'middle', patch: { zIndex: 9 } },
      { id: 'top', patch: { zIndex: 5 } },
    ]);
    expect(layerMovePatches(stack(), 'middle', 'backward')).toEqual([
      { id: 'middle', patch: { zIndex: 0 } },
      { id: 'bottom', patch: { zIndex: 5 } },
    ]);
  });

  it('breaks ties by assigning an adjacent value to the moved element only', () => {
    const tied = [
      element({ id: 'a', zIndex: 2 }),
      element({ id: 'b', zIndex: 2 }),
      element({ id: 'c', zIndex: 2 }),
    ];
    expect(layerMovePatches(tied, 'b', 'forward')).toEqual([{ id: 'b', patch: { zIndex: 3 } }]);
    expect(layerMovePatches(tied, 'b', 'backward')).toEqual([{ id: 'b', patch: { zIndex: 1 } }]);
    // Moving below zero is allowed so legacy all-zero boards stay consistent.
    const legacy = [element({ id: 'x' }), element({ id: 'y' })];
    expect(layerMovePatches(legacy, 'y', 'backward')).toEqual([{ id: 'y', patch: { zIndex: -1 } }]);
  });

  it('returns no patches at the stack edges or for unknown/arrow elements', () => {
    const elements = stack();
    expect(layerMovePatches(elements, 'top', 'forward')).toEqual([]);
    expect(layerMovePatches(elements, 'bottom', 'backward')).toEqual([]);
    expect(layerMovePatches(elements, 'missing', 'forward')).toEqual([]);
    expect(layerMovePatches(elements, 'arrow', 'forward')).toEqual([]);
  });
});

describe('nextTopZIndex', () => {
  it('starts at 0 on an empty board and ignores arrows', () => {
    expect(nextTopZIndex([])).toBe(0);
    expect(nextTopZIndex([element({ id: 'arrow', type: 'arrow', zIndex: 50 })])).toBe(0);
  });

  it('places new elements above the current stack', () => {
    expect(nextTopZIndex(stack())).toBe(10);
    expect(nextTopZIndex([element({ id: 'neg', zIndex: -7 })])).toBe(0);
  });
});

describe('buildStrokeGeometry', () => {
  it('computes the bounding box and normalized points', () => {
    const geometry = buildStrokeGeometry([
      { wx: 100, wy: 200 },
      { wx: 300, wy: 260 },
      { wx: 200, wy: 230 },
    ]);
    expect(geometry.x).toBe(100);
    expect(geometry.y).toBe(200);
    expect(geometry.width).toBe(200);
    expect(geometry.height).toBe(60);
    expect(geometry.points).toEqual([
      [0, 0],
      [1, 1],
      [0.5, 0.5],
    ]);
  });

  it('expands tiny scribbles to the minimum size around their center', () => {
    const geometry = buildStrokeGeometry([
      { wx: 10, wy: 10 },
      { wx: 12, wy: 12 },
    ]);
    expect(geometry.width).toBe(60);
    expect(geometry.height).toBe(60);
    // The center of the expanded box stays on the drawn point cloud center.
    const centerX = geometry.x + geometry.width / 2;
    const centerY = geometry.y + geometry.height / 2;
    expect(centerX).toBeCloseTo(11);
    expect(centerY).toBeCloseTo(11);
  });
});

describe('shape tool helpers', () => {
  it('detects shape tools and maps them onto their kind', () => {
    expect(isShapeTool('rect')).toBe(true);
    expect(isShapeTool('diamond')).toBe(true);
    expect(isShapeTool('draw')).toBe(false);
    expect(isShapeTool('note')).toBe(false);
    expect(shapeKindForTool('triangle')).toBe('triangle');
    // Non-shape tools fall back to the default outline variant.
    expect(shapeKindForTool('select')).toBe('rect');
  });
});
