import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchJson, UpstreamError } from '../common/http.util';
import type { Coordinates } from '../common/geo.types';
import type {
  FutureDepartureEta,
  RouteBundle,
  RouteOption,
  TravelMode,
} from './routing.types';

/** Departure offsets, in minutes, probed for the "should I wait?" decision. */
const FUTURE_OFFSETS_MINUTES = [10, 20, 30];

interface MapboxRoute {
  duration: number;
  duration_typical?: number;
  distance: number;
  geometry: { coordinates: Array<[number, number]> };
  legs?: Array<{ annotation?: { congestion_numeric?: Array<number | null> } }>;
}

interface MapboxDirectionsResponse {
  code: string;
  message?: string;
  routes: MapboxRoute[];
}

/**
 * Routes only. Place search and reverse geocoding live in PlacesService,
 * which talks to a different provider - Mapbox routes Ghana well but barely
 * knows its place names.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);
  /**
   * Predictive traffic (`depart_at`) is not enabled on every Mapbox plan. We
   * probe once, and if it is rejected we stop asking for the rest of the
   * process lifetime rather than paying three failed round trips per request.
   */
  private predictiveTrafficSupported = true;

  constructor(private readonly config: ConfigService) {}

  private get token(): string {
    const token = this.config.get<string>('mapboxAccessToken');
    if (!token) {
      throw new ServiceUnavailableException(
        'MAPBOX_ACCESS_TOKEN is not configured. Add it to your .env file.',
      );
    }
    return token;
  }

  private get timeout(): number {
    return this.config.get<number>('upstreamTimeoutMs') ?? 8000;
  }

  /**
   * Everything the recommendation needs from the routing provider: a live
   * driving route, a walking route, and predicted ETAs for leaving later.
   *
   * The three lookups are independent, so they run concurrently and each is
   * allowed to fail on its own. A missing walking route should never take down
   * the whole recommendation.
   */
  async getRouteBundle(origin: Coordinates, destination: Coordinates): Promise<RouteBundle> {
    const [driving, walking, futureDepartures] = await Promise.all([
      this.getRoute(origin, destination, 'driving').catch((error) => {
        this.logger.warn(`Driving route failed: ${String(error)}`);
        return null;
      }),
      this.getRoute(origin, destination, 'walking').catch((error) => {
        this.logger.warn(`Walking route failed: ${String(error)}`);
        return null;
      }),
      this.getFutureDepartures(origin, destination),
    ]);

    if (!driving && !walking) {
      throw new UpstreamError('mapbox', 'no route available for either mode');
    }

    return {
      driving,
      walking,
      futureDepartures,
      predictiveTrafficAvailable: futureDepartures.length > 0,
    };
  }

  async getRoute(
    origin: Coordinates,
    destination: Coordinates,
    mode: TravelMode,
    departAt?: Date,
  ): Promise<RouteOption> {
    const profile = mode === 'driving' ? 'driving-traffic' : 'walking';
    const coordinates = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`;
    const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordinates}`);
    url.searchParams.set('access_token', this.token);
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('overview', 'full');
    url.searchParams.set('steps', 'false');

    if (mode === 'driving') {
      url.searchParams.set('annotations', 'duration,congestion_numeric');
      if (departAt) {
        // Mapbox accepts YYYY-MM-DDThh:mm, YYYY-MM-DDThh:mm:ssZ, or an
        // explicit offset - and nothing else. toISOString() carries
        // milliseconds, which is rejected with a 422, so trim to whole seconds
        // and keep the Z.
        url.searchParams.set('depart_at', `${departAt.toISOString().slice(0, 19)}Z`);
      }
    }

    const response = await fetchJson<MapboxDirectionsResponse>(url.toString(), {
      source: `mapbox-${profile}`,
      timeoutMs: this.timeout,
    });

    const route = response.routes?.[0];
    if (!route) {
      throw new UpstreamError('mapbox', `no ${mode} route found (code ${response.code})`);
    }

    const typical = typeof route.duration_typical === 'number' ? route.duration_typical : null;

    return {
      mode,
      durationSeconds: Math.round(route.duration),
      typicalDurationSeconds: typical === null ? null : Math.round(typical),
      trafficDelayMinutes:
        typical === null ? null : Math.round(((route.duration - typical) / 60) * 10) / 10,
      distanceMeters: Math.round(route.distance),
      geometry: route.geometry?.coordinates ?? [],
      congestionShare: congestionShare(route),
    };
  }

  private async getFutureDepartures(
    origin: Coordinates,
    destination: Coordinates,
  ): Promise<FutureDepartureEta[]> {
    if (!this.predictiveTrafficSupported) return [];

    const results = await Promise.all(
      FUTURE_OFFSETS_MINUTES.map(async (offsetMinutes) => {
        const departAt = new Date(Date.now() + offsetMinutes * 60_000);
        try {
          const route = await this.getRoute(origin, destination, 'driving', departAt);
          return { offsetMinutes, durationSeconds: route.durationSeconds };
        } catch (error) {
          if (error instanceof UpstreamError && error.status && error.status < 500) {
            this.predictiveTrafficSupported = false;
            this.logger.warn(
              'Predictive traffic (depart_at) rejected by Mapbox; falling back to ' +
                'the live-vs-typical delta as the wait/leave proxy.',
            );
          }
          return null;
        }
      }),
    );

    return results.filter((item): item is FutureDepartureEta => item !== null);
  }
}

/**
 * Mapbox congestion_numeric is 0-100 per road segment, with null for segments
 * it has no data on. We reduce it to a single "how much of this drive is
 * genuinely jammed" number, which is far easier for the model to reason about
 * than a thousand-element array.
 */
function congestionShare(route: MapboxRoute): number | null {
  const values = (route.legs ?? [])
    .flatMap((leg) => leg.annotation?.congestion_numeric ?? [])
    .filter((value): value is number => typeof value === 'number');

  if (values.length === 0) return null;

  const heavy = values.filter((value) => value >= 60).length;
  return Math.round((heavy / values.length) * 100) / 100;
}
