/**
 * Encoded-polyline helpers for the static map overlay.
 *
 * A route comes back from the routing provider as a few hundred raw
 * coordinates. Putting those in a URL would blow past the length limit, so
 * they are thinned with Douglas-Peucker and then encoded. A 12 km Accra route
 * goes from 162 points to about 28, which is roughly 100 characters - visually
 * identical at map scale.
 */

export type Point = [number, number];

/**
 * Google/Mapbox encoded polyline, precision 5.
 *
 * Input is `[lon, lat]` to match GeoJSON, but the format encodes latitude
 * first, so the pair is swapped on the way in.
 */
export function encodePolyline(points: Point[]): string {
  let lastLat = 0;
  let lastLon = 0;
  let out = '';

  for (const [lon, lat] of points) {
    const scaledLat = Math.round(lat * 1e5);
    const scaledLon = Math.round(lon * 1e5);
    out += encodeValue(scaledLat - lastLat) + encodeValue(scaledLon - lastLon);
    lastLat = scaledLat;
    lastLon = scaledLon;
  }

  return out;
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';

  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }

  return out + String.fromCharCode(v + 63);
}

/**
 * Douglas-Peucker line simplification.
 *
 * Tolerance is in degrees, which is crude but adequate: at Ghana's latitude
 * 0.0001 degrees is roughly 11 m, far below what a 640 px map can resolve.
 */
export function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return [...points];

  const keep = new Set<number>([0, points.length - 1]);
  walk(points, 0, points.length - 1, tolerance * tolerance, keep);

  return [...keep].sort((a, b) => a - b).map((index) => points[index]);
}

function walk(
  points: Point[],
  first: number,
  last: number,
  toleranceSq: number,
  keep: Set<number>,
): void {
  let maxSq = toleranceSq;
  let index = -1;

  for (let i = first + 1; i < last; i += 1) {
    const sq = squaredDistanceToSegment(points[i], points[first], points[last]);
    if (sq > maxSq) {
      index = i;
      maxSq = sq;
    }
  }

  if (index === -1) return;

  walk(points, first, index, toleranceSq, keep);
  keep.add(index);
  walk(points, index, last, toleranceSq, keep);
}

function squaredDistanceToSegment(point: Point, start: Point, end: Point): number {
  let [x, y] = start;
  let dx = end[0] - x;
  let dy = end[1] - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      [x, y] = end;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}
