import { describe, expect, it } from 'vitest';
import { buildSmoothRoutePath } from '~/lib/utils/routePath';

function getLineYAt(x: number, startX: number, startY: number, endX: number, endY: number) {
  const ratio = (x - startX) / (endX - startX);
  return startY + (endY - startY) * ratio;
}

function getSignedDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
}

describe('buildSmoothRoutePath', () => {
  it('keeps nearly aligned route sections close to the original line while easing the join', () => {
    const path = buildSmoothRoutePath([
      { x: 80, y: 160 },
      { x: 100, y: 150 },
      { x: 120, y: 140 },
    ]);

    const values = (path.match(/-?\d+\.\d+/g) ?? []).map(Number);
    const [startX, startY, entryX, entryY, controlX, controlY, exitX, exitY, endX, endY] = values;

    expect(controlX).toBe(100);
    expect(controlY).toBe(150);
    expect(Math.abs(entryY - getLineYAt(entryX, startX, startY, endX, endY))).toBeLessThan(0.01);
    expect(Math.abs(exitY - getLineYAt(exitX, startX, startY, endX, endY))).toBeLessThan(0.01);
  });

  it('uses an eased quadratic path instead of cubic bends on every segment', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 10 },
      { x: 40, y: 0 },
      { x: 60, y: 10 },
      { x: 80, y: 0 },
    ];

    const path = buildSmoothRoutePath(points);

    expect(path).not.toContain(' C ');
    expect(path).toContain(' Q ');
  });

  it('keeps the actual sampled route points in the path instead of replacing them with a broad arc', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 10 },
      { x: 40, y: 0 },
      { x: 60, y: 10 },
      { x: 80, y: 0 },
    ];

    const path = buildSmoothRoutePath(points);

    expect(path).toContain('20.00 10.00');
    expect(path).toContain('40.00 0.00');
    expect(path).toContain('60.00 10.00');
  });

  it('keeps each curved segment bending in one direction instead of zig-zagging', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 10 },
      { x: 40, y: 0 },
      { x: 60, y: 10 },
      { x: 80, y: 0 },
    ];

    const path = buildSmoothRoutePath(points);
    const values = (path.match(/-?\d+\.\d+/g) ?? []).map(Number);
    let start = points[0]!;

    for (let offset = 2; offset + 3 < values.length; offset += 4) {
      const control = { x: values[offset]!, y: values[offset + 1]! };
      const end = { x: values[offset + 2]!, y: values[offset + 3]! };
      const distance = getSignedDistance(control, start, end);

      expect(Math.sign(distance || 1)).toBeTruthy();
      start = end;
    }
  });
});
