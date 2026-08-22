import { describe, expect, it } from 'vitest';
import { buildStrokeGeometry, isShapeTool, shapeKindForTool } from './whiteboardShared';

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
