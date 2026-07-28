const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in metres between two [lon, lat] pairs. */
export function haversineMeters(a: [number, number], b: [number, number]): number {
  const [lonA, latA] = a;
  const [lonB, latB] = b;

  const dLat = toRadians(latB - latA);
  const dLon = toRadians(lonB - lonA);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface PointAlongRoute {
  lat: number;
  lon: number;
  /** 0 at the origin, 1 at the destination. */
  fraction: number;
}

/**
 * Picks points at given fractions of the route's *distance*, walking the
 * polyline and interpolating inside the segment the fraction lands in.
 *
 * Sampling by distance rather than by array index matters because routing
 * providers emit vertices unevenly - dense through junctions, sparse on a
 * highway - so index-based sampling would cluster every "midpoint" around the
 * nearest interchange instead of the actual middle of the trip.
 */
export function pointsAlongRoute(
  geometry: Array<[number, number]>,
  fractions: number[],
): PointAlongRoute[] {
  if (geometry.length === 0) return [];
  if (geometry.length === 1) {
    const [lon, lat] = geometry[0];
    return fractions.map((fraction) => ({ lat, lon, fraction }));
  }

  const cumulative: number[] = [0];
  for (let i = 1; i < geometry.length; i += 1) {
    cumulative.push(cumulative[i - 1] + haversineMeters(geometry[i - 1], geometry[i]));
  }
  const total = cumulative[cumulative.length - 1];

  return fractions.map((fraction) => {
    const clamped = Math.min(1, Math.max(0, fraction));

    if (total === 0) {
      const [lon, lat] = geometry[0];
      return { lat, lon, fraction: clamped };
    }

    const target = clamped * total;
    let index = cumulative.findIndex((value) => value >= target);
    if (index <= 0) index = 1;

    const segmentStart = cumulative[index - 1];
    const segmentLength = cumulative[index] - segmentStart;
    const ratio = segmentLength === 0 ? 0 : (target - segmentStart) / segmentLength;

    const [lonA, latA] = geometry[index - 1];
    const [lonB, latB] = geometry[index];

    return {
      lon: round6(lonA + (lonB - lonA) * ratio),
      lat: round6(latA + (latB - latA) * ratio),
      fraction: clamped,
    };
  });
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
