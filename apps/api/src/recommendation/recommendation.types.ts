import type { Place, TravelMode } from '../routing/routing.types';
import type { RouteWeather } from '../weather/weather.types';

export type RecommendationKind = 'leave_now' | 'wait' | 'leave_by';

/** Exactly the object Gemma 4 is contracted to return. */
export interface Advice {
  recommendation: RecommendationKind;
  leave_by_time: string | null;
  wait_minutes: number | null;
  best_mode: TravelMode;
  headline: string;
  reasoning: string;
  advisory: string | null;
}

export interface ModeSummary {
  mode: TravelMode;
  etaMinutes: number;
  typicalEtaMinutes: number | null;
  trafficDelayMinutes: number | null;
  distanceKm: number;
  congestionShare: number | null;
}

/**
 * What `POST /recommendation` returns. Route geometry is deliberately dropped
 * before it reaches the client: the UI does not draw a map, and shipping a
 * few thousand coordinates to a phone on a metered connection would undo the
 * point of the product.
 */
export interface RecommendationResult {
  advice: Advice;
  origin: Place;
  destination: Place;
  driving: ModeSummary | null;
  walking: ModeSummary | null;
  futureDepartures: Array<{ offsetMinutes: number; etaMinutes: number; deltaMinutes: number }>;
  predictiveTrafficAvailable: boolean;
  weather: RouteWeather;
  model: string;
  /**
   * When the origin coordinates were actually captured from the device.
   *
   * Distinct from `generatedAt`: a background re-check inherits the origin
   * from the last real user request, so this timestamp must not move when the
   * answer is recomputed. It is what tells the sweep the location has gone
   * stale and watching should stop.
   */
  originCapturedAt: string;
  /**
   * Path to the route image, e.g. "/api/map/<id>.png". Null when Mapbox is
   * unconfigured or the route has no drawable shape. The client fetches it
   * lazily, only when the "why" drawer is opened.
   */
  mapUrl: string | null;
  generatedAt: string;
  /** True when live data could not be fetched and this is a replayed answer. */
  stale: boolean;
  /** Present only when stale, explains what failed. */
  staleReason?: string;
}
