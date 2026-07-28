import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchJson, UpstreamError } from '../common/http.util';
import type {
  Coordinates,
  FutureDepartureEta,
  Place,
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

interface MapboxGeocodeResponse {
  features: Array<{
    properties: {
      name?: string;
      full_address?: string;
      place_formatted?: string;
      coordinates?: { longitude: number; latitude: number };
    };
    geometry?: { coordinates: [number, number] };
  }>;
}

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

  /** Free-text destination search, biased toward the user's current position. */
  async searchPlaces(query: string, near?: Coordinates, limit = 5): Promise<Place[]> {
    const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
    url.searchParams.set('q', query);
    url.searchParams.set('access_token', this.token);
    url.searchParams.set('limit', String(limit));
    if (near) {
      url.searchParams.set('proximity', `${near.lon},${near.lat}`);
    }

    const response = await fetchJson<MapboxGeocodeResponse>(url.toString(), {
      source: 'mapbox-geocode',
      timeoutMs: this.timeout,
    });

    return (response.features ?? []).flatMap((feature) => {
      const lon = feature.properties.coordinates?.longitude ?? feature.geometry?.coordinates?.[0];
      const lat = feature.properties.coordinates?.latitude ?? feature.geometry?.coordinates?.[1];
      if (typeof lon !== 'number' || typeof lat !== 'number') return [];

      const name = feature.properties.name ?? 'Unnamed place';
      return [
        {
          name,
          address: feature.properties.full_address ?? feature.properties.place_formatted ?? name,
          lat,
          lon,
        },
      ];
    });
  }

  /** Turns a raw GPS fix into something we can show the user by name. */
  async describeLocation(point: Coordinates): Promise<Place> {
    const url = new URL('https://api.mapbox.com/search/geocode/v6/reverse');
    url.searchParams.set('longitude', String(point.lon));
    url.searchParams.set('latitude', String(point.lat));
    url.searchParams.set('access_token', this.token);
    url.searchParams.set('limit', '1');

    try {
      const response = await fetchJson<MapboxGeocodeResponse>(url.toString(), {
        source: 'mapbox-reverse-geocode',
        timeoutMs: this.timeout,
        retries: 0,
      });
      const feature = response.features?.[0];
      if (feature) {
        const name = feature.properties.name ?? 'Current location';
        return {
          name,
          address: feature.properties.full_address ?? feature.properties.place_formatted ?? name,
          ...point,
        };
      }
    } catch (error) {
      this.logger.warn(`Reverse geocode failed, using raw coordinates: ${String(error)}`);
    }

    return { name: 'Current location', address: 'Your current position', ...point };
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
        // Mapbox expects a local ISO string with no timezone suffix.
        url.searchParams.set('depart_at', departAt.toISOString().slice(0, 19));
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
