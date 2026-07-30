import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { UpstreamError } from '../common/http.util';
import { sliceByFractions } from '../common/geo.util';
import { encodePolyline, simplify, type Point } from './polyline';
import { MapSnapshotRepository, type MapSnapshot } from './map-snapshot.repository';
import type { Coordinates } from '../common/geo.types';
import type { RouteWeather } from '../weather/weather.types';

/** Roughly 11 m at Ghana's latitude - well below what a 640 px map resolves. */
const SIMPLIFY_TOLERANCE_DEGREES = 0.0001;

/** Mapbox rejects requests over 8192 characters; stay well clear. */
const MAX_URL_LENGTH = 7000;

const DRY_COLOUR = '35d6a0';
const WET_COLOUR = '4fb6f5';

/**
 * Renders the route as a single static image, coloured by the weather.
 *
 * The image is proxied rather than linked, because the URL has to carry the
 * Mapbox token and that token must never reach a browser. It is also
 * generated lazily - the client asks for it only when the "Why" drawer opens,
 * so the great majority of requests never pay the ~77 KB.
 *
 * `mapbox/dark-v11` is used rather than a navigation style: navigation styles
 * draw their own traffic colours, which compete with the green/blue we use to
 * mean dry/wet and would be read as this route's congestion.
 */
@Injectable()
export class StaticMapService {
  private readonly logger = new Logger(StaticMapService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly snapshots: MapSnapshotRepository,
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.get<string>('mapboxAccessToken'));
  }

  /**
   * Stores what the map needs and returns the path the client should request.
   * Returns null when the route or the token is unusable, in which case the UI
   * simply shows no map.
   */
  createSnapshot(
    geometry: Array<[number, number]>,
    weather: RouteWeather,
    origin: Coordinates,
    destination: Coordinates,
  ): string | null {
    if (!this.enabled || geometry.length < 2) return null;

    const segments = this.buildSegments(geometry, weather);
    if (segments.length === 0) return null;

    const id = randomUUID();
    this.snapshots.save({
      id,
      segments,
      // A coarser encoding of the whole route, used if the coloured version
      // overflows the URL limit. It must be encoded as one continuous path:
      // concatenating the segment strings would not decode, since each one
      // restarts its deltas from zero.
      fallbackPolyline: encodePolyline(
        simplify(geometry as Point[], SIMPLIFY_TOLERANCE_DEGREES * 6),
      ),
      origin,
      destination,
    });

    return `/api/map/${id}.png`;
  }

  /** Fetches the rendered PNG for a stored snapshot. */
  async render(id: string): Promise<Buffer> {
    const snapshot = this.snapshots.find(id);
    if (!snapshot) throw new NotFoundException('That map has expired');

    const token = this.config.get<string>('mapboxAccessToken');
    if (!token) throw new ServiceUnavailableException('Mapbox is not configured');

    const response = await fetch(this.buildUrl(snapshot, token), {
      signal: AbortSignal.timeout(this.config.get<number>('upstreamTimeoutMs') ?? 8000),
    }).catch((error: Error) => {
      throw new UpstreamError('mapbox-static', error.message);
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new UpstreamError(
        'mapbox-static',
        `HTTP ${response.status} ${detail.slice(0, 160)}`,
        response.status,
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * One coloured slice per gap between weather sample points. A slice counts
   * as wet if either end of it is, so a shower is never hidden by the dry
   * sample on its far side.
   */
  private buildSegments(
    geometry: Array<[number, number]>,
    weather: RouteWeather,
  ): MapSnapshot['segments'] {
    const samples = weather.samples;

    // With no usable forecast the route is still worth drawing, just in one
    // neutral colour rather than pretending to know the conditions.
    if (samples.length < 2) {
      const points = simplify(geometry as Point[], SIMPLIFY_TOLERANCE_DEGREES);
      return [{ polyline: encodePolyline(points), wet: false }];
    }

    const fractions = samples.map((sample) => sample.fractionAlongRoute);
    const slices = sliceByFractions(geometry, fractions);

    return slices.flatMap((slice, index) => {
      const points = simplify(slice as Point[], SIMPLIFY_TOLERANCE_DEGREES);
      if (points.length < 2) return [];

      return [
        {
          polyline: encodePolyline(points),
          wet: Boolean(samples[index]?.wet || samples[index + 1]?.wet),
        },
      ];
    });
  }

  private buildUrl(snapshot: MapSnapshot, token: string): string {
    const style = this.config.get<string>('mapStyle') ?? 'dark-v11';
    const size = this.config.get<string>('mapSize') ?? '640x360';

    const overlays = [
      ...snapshot.segments.map(
        (segment) =>
          `path-5+${segment.wet ? WET_COLOUR : DRY_COLOUR}-0.95(${encodeURIComponent(segment.polyline)})`,
      ),
      `pin-s+${DRY_COLOUR}(${snapshot.origin.lon},${snapshot.origin.lat})`,
      `pin-s+f7b955(${snapshot.destination.lon},${snapshot.destination.lat})`,
    ];

    const build = (parts: string[]): string =>
      `https://api.mapbox.com/styles/v1/mapbox/${style}/static/${parts.join(',')}` +
      `/auto/${size}?padding=44&access_token=${token}`;

    let url = build(overlays);

    // A very long route can still overflow the URL limit once encoded. Drop
    // the coloured detail before dropping the map: one plain line beats none.
    if (url.length > MAX_URL_LENGTH && snapshot.fallbackPolyline) {
      this.logger.warn('Static map URL too long; falling back to a single simplified line.');
      url = build([
        `path-5+${DRY_COLOUR}-0.95(${encodeURIComponent(snapshot.fallbackPolyline)})`,
        `pin-s+${DRY_COLOUR}(${snapshot.origin.lon},${snapshot.origin.lat})`,
        `pin-s+f7b955(${snapshot.destination.lon},${snapshot.destination.lat})`,
      ]);
    }

    return url;
  }
}
