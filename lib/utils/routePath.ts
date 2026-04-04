export interface SvgRoutePoint {
  x: number;
  y: number;
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatPoint(point: SvgRoutePoint): string {
  return `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
}

function getArcControlPoint(start: SvgRoutePoint, end: SvgRoutePoint): SvgRoutePoint {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const distance = Math.hypot(deltaX, deltaY);

  if (distance < 0.01) {
    return { x: end.x, y: end.y };
  }

  const normalX = -deltaY / distance;
  const normalY = deltaX / distance;
  const bend = clampValue(distance * 0.18, 10, 42);
  const direction = normalY >= 0 ? -1 : 1;

  return {
    x: (start.x + end.x) / 2 + normalX * bend * direction,
    y: (start.y + end.y) / 2 + normalY * bend * direction,
  };
}

export function buildSmoothRoutePath(points: SvgRoutePoint[]): string {
  if (points.length === 0) {
    return '';
  }

  if (points.length === 1) {
    return `M ${formatPoint(points[0]!)}`;
  }

  if (points.length === 2) {
    const [start, end] = points;
    const control = getArcControlPoint(start!, end!);
    return `M ${formatPoint(start!)} Q ${formatPoint(control)} ${formatPoint(end!)}`;
  }

  const smoothing = 1 / 6;
  let path = `M ${formatPoint(points[0]!)}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const afterNext = points[index + 2] ?? next;

    const control1 = {
      x: current.x + (next.x - previous.x) * smoothing,
      y: current.y + (next.y - previous.y) * smoothing,
    };
    const control2 = {
      x: next.x - (afterNext.x - current.x) * smoothing,
      y: next.y - (afterNext.y - current.y) * smoothing,
    };

    path += ` C ${formatPoint(control1)} ${formatPoint(control2)} ${formatPoint(next)}`;
  }

  return path;
}
