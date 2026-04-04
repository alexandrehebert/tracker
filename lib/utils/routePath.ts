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

function getDistanceBetweenPoints(first: SvgRoutePoint, second: SvgRoutePoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function getPointToward(start: SvgRoutePoint, end: SvgRoutePoint, distance: number): SvgRoutePoint {
  const segmentLength = getDistanceBetweenPoints(start, end);

  if (segmentLength < 0.01 || distance <= 0) {
    return { x: start.x, y: start.y };
  }

  const ratio = Math.min(1, distance / segmentLength);
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
}

function normalizeRoutePoints(points: SvgRoutePoint[]): SvgRoutePoint[] {
  return points.filter((point, index) => {
    const previous = points[index - 1];

    return !previous
      || Math.abs(previous.x - point.x) > 0.01
      || Math.abs(previous.y - point.y) > 0.01;
  });
}

function getTwoPointControlPoint(start: SvgRoutePoint, end: SvgRoutePoint): SvgRoutePoint {
  const distance = getDistanceBetweenPoints(start, end);

  if (distance < 0.01) {
    return {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };
  }

  const normalX = -(end.y - start.y) / distance;
  const normalY = (end.x - start.x) / distance;
  const bend = clampValue(distance * 0.08, 0, 8);
  const direction = normalY >= 0 ? -1 : 1;

  return {
    x: (start.x + end.x) / 2 + normalX * bend * direction,
    y: (start.y + end.y) / 2 + normalY * bend * direction,
  };
}

export function buildSmoothRoutePath(points: SvgRoutePoint[]): string {
  const normalizedPoints = normalizeRoutePoints(points);

  if (normalizedPoints.length === 0) {
    return '';
  }

  if (normalizedPoints.length === 1) {
    return `M ${formatPoint(normalizedPoints[0]!)}`;
  }

  if (normalizedPoints.length === 2) {
    const start = normalizedPoints[0]!;
    const end = normalizedPoints[1]!;
    const control = getTwoPointControlPoint(start, end);

    return `M ${formatPoint(start)} Q ${formatPoint(control)} ${formatPoint(end)}`;
  }

  let path = `M ${formatPoint(normalizedPoints[0]!)}`;

  for (let index = 1; index < normalizedPoints.length - 1; index += 1) {
    const previous = normalizedPoints[index - 1]!;
    const current = normalizedPoints[index]!;
    const next = normalizedPoints[index + 1]!;
    const incomingLength = getDistanceBetweenPoints(previous, current);
    const outgoingLength = getDistanceBetweenPoints(current, next);

    if (incomingLength < 0.01 || outgoingLength < 0.01) {
      path += ` L ${formatPoint(current)}`;
      continue;
    }

    const easingDistance = clampValue(Math.min(incomingLength, outgoingLength) * 0.22, 2, 12);
    const entry = getPointToward(current, previous, easingDistance);
    const exit = getPointToward(current, next, easingDistance);

    path += ` L ${formatPoint(entry)} Q ${formatPoint(current)} ${formatPoint(exit)}`;
  }

  path += ` L ${formatPoint(normalizedPoints.at(-1)!)} `;
  return path.trim();
}
