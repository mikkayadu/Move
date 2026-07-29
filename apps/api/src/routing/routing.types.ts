export type { Coordinates, Place } from '../common/geo.types';

export type TravelMode = 'driving' | 'walking';

export interface RouteOption {
  mode: TravelMode;
  /** Traffic-aware duration in seconds (live for driving, static for walking). */
  durationSeconds: number;
  /**
   * Duration in seconds under typical conditions for this time of week.
   * Mapbox only returns this for the driving-traffic profile.
   */
  typicalDurationSeconds: number | null;
  /** Live minus typical, in minutes. Positive means worse than usual. */
  trafficDelayMinutes: number | null;
  distanceMeters: number;
  /** Decoded [lon, lat] pairs describing the full route line. */
  geometry: Array<[number, number]>;
  /**
   * Share of the route currently in heavy or severe congestion, 0-1.
   * Derived from Mapbox congestion annotations; null when unavailable.
   */
  congestionShare: number | null;
}

export interface FutureDepartureEta {
  /** Minutes from now that this hypothetical departure happens. */
  offsetMinutes: number;
  durationSeconds: number;
}

export interface RouteBundle {
  driving: RouteOption | null;
  walking: RouteOption | null;
  /**
   * Predicted driving ETAs for departures later than now. Empty when the
   * routing plan does not expose predictive traffic, in which case the
   * recommendation layer falls back to the live-vs-typical delta as a proxy.
   */
  futureDepartures: FutureDepartureEta[];
  predictiveTrafficAvailable: boolean;
}
