import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { GemmaService } from '../llm/gemma.service';
import { PlacesService } from '../places/places.service';
import { RoutingService } from '../routing/routing.service';
import { WeatherService } from '../weather/weather.service';
import { AdviceParseError, parseAdvice } from './advice.parser';
import { RecommendationStateRepository } from './recommendation-state.repository';
import type { Coordinates, Place } from '../common/geo.types';
import type { RouteBundle, RouteOption } from '../routing/routing.types';
import type { RouteWeather } from '../weather/weather.types';
import type { Advice, ModeSummary, RecommendationResult } from './recommendation.types';

export interface RecommendationRequest {
  origin: Coordinates;
  destination: Coordinates & { name?: string; address?: string };
  /** IANA zone from the browser, so "leave by 17:40" means the user's 17:40. */
  timezone?: string;
  /** Set when the trip targets a saved destination, for change detection. */
  destinationId?: string;
}

/** Walking is never the answer beyond this, whatever the model thinks. */
const MAX_SENSIBLE_WALK_MINUTES = 60;

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(
    private readonly routing: RoutingService,
    private readonly places: PlacesService,
    private readonly weather: WeatherService,
    private readonly gemma: GemmaService,
    private readonly state: RecommendationStateRepository,
  ) {}

  /**
   * The whole pipeline: route, weather along that route, Gemma 4, one card.
   *
   * If any live leg fails we fall back to the last stored answer for this trip
   * and mark it stale rather than showing an error. On a patchy connection a
   * ten-minute-old answer is still a good answer, and it is certainly better
   * than a spinner.
   */
  async getRecommendation(
    deviceId: string,
    request: RecommendationRequest,
  ): Promise<RecommendationResult> {
    const cacheKey = buildCacheKey(deviceId, request);

    try {
      const result = await this.buildLive(request);
      this.state.save(cacheKey, deviceId, request.destinationId ?? null, result);
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown failure';
      this.logger.error(`Live recommendation failed: ${reason}`);

      const cached =
        this.state.find(cacheKey) ??
        (request.destinationId
          ? this.state.findLatestForDestination(deviceId, request.destinationId)
          : null);

      if (!cached) {
        throw new ServiceUnavailableException(
          'Could not reach the routing, weather, or reasoning service, and there is ' +
            'no earlier answer for this trip to fall back on.',
        );
      }

      this.logger.warn(`Serving cached recommendation from ${cached.createdAt}`);
      return {
        ...cached.result,
        stale: true,
        staleReason: reason,
        generatedAt: cached.createdAt,
      };
    }
  }

  private async buildLive(request: RecommendationRequest): Promise<RecommendationResult> {
    const [originPlace, bundle] = await Promise.all([
      this.places.describeLocation(request.origin),
      this.routing.getRouteBundle(request.origin, request.destination),
    ]);

    const primary = bundle.driving ?? bundle.walking;
    if (!primary) throw new Error('No route available in any mode');

    const weather = await this.sampleWeather(primary);
    const destination = this.describeDestination(request);
    const payload = this.buildPayload(request, originPlace, destination, bundle, weather);
    const advice = this.reconcile(await this.askGemma(payload), bundle);

    return {
      advice,
      origin: originPlace,
      destination,
      driving: summarise(bundle.driving),
      walking: summarise(bundle.walking),
      futureDepartures: bundle.futureDepartures.map((entry) => ({
        offsetMinutes: entry.offsetMinutes,
        etaMinutes: Math.round(entry.durationSeconds / 60),
        deltaMinutes: Math.round((entry.durationSeconds - primary.durationSeconds) / 60),
      })),
      predictiveTrafficAvailable: bundle.predictiveTrafficAvailable,
      weather,
      model: this.gemma.model,
      generatedAt: new Date().toISOString(),
      stale: false,
    };
  }

  /**
   * Weather failing should degrade the answer, not delete it. The model is
   * told explicitly that the forecast is missing so it does not invent one.
   */
  private async sampleWeather(primary: RouteOption): Promise<RouteWeather> {
    try {
      return await this.weather.getRouteWeather(primary.geometry, primary.durationSeconds);
    } catch (error) {
      this.logger.warn(`Weather sampling failed, continuing without it: ${String(error)}`);
      return {
        samples: [],
        maxPrecipitationProbabilityPct: null,
        rainExpectedOnRoute: false,
        rainStartsInMinutes: null,
        rainClearsInMinutes: null,
        summary: 'Weather data unavailable for this route.',
      };
    }
  }

  private describeDestination(request: RecommendationRequest): Place {
    return {
      name: request.destination.name ?? 'Destination',
      address: request.destination.address ?? request.destination.name ?? 'Selected destination',
      lat: request.destination.lat,
      lon: request.destination.lon,
    };
  }

  /** One retry with an explicit correction, as the model contract is strict. */
  private async askGemma(payload: unknown): Promise<Advice> {
    const raw = await this.gemma.generate(payload);

    try {
      return parseAdvice(raw);
    } catch (error) {
      if (!(error instanceof AdviceParseError)) throw error;

      this.logger.warn(`First Gemma response did not parse (${error.message}); retrying once.`);
      const retry = await this.gemma.generate(
        payload,
        'Your previous reply could not be parsed. Reply with the raw JSON object only: ' +
          'no code fences, no explanation, no text before or after it.',
      );
      return parseAdvice(retry);
    }
  }

  /**
   * Guards the model's mode choice against the routes we actually have. The
   * model reasons well about trade-offs but should never be able to recommend
   * a 90-minute walk, or a mode we have no route for.
   */
  private reconcile(advice: Advice, bundle: RouteBundle): Advice {
    const walkMinutes = bundle.walking ? bundle.walking.durationSeconds / 60 : null;

    if (advice.best_mode === 'walking') {
      const unusable = walkMinutes === null || walkMinutes > MAX_SENSIBLE_WALK_MINUTES;
      if (unusable && bundle.driving) {
        this.logger.warn('Overriding walking recommendation: no sensible walking route exists.');
        return { ...advice, best_mode: 'driving' };
      }
    }

    if (advice.best_mode === 'driving' && !bundle.driving && bundle.walking) {
      return { ...advice, best_mode: 'walking' };
    }

    return advice;
  }

  /**
   * The briefing handed to Gemma 4. Field names are written for a reader, not
   * for byte efficiency, because that is what small models reason best over.
   */
  private buildPayload(
    request: RecommendationRequest,
    origin: Place,
    destination: Place,
    bundle: RouteBundle,
    weather: RouteWeather,
  ): Record<string, unknown> {
    const { time, day } = localTimeParts(request.timezone);
    const primary = bundle.driving ?? bundle.walking!;

    return {
      local_time: time,
      day_of_week: day,
      origin: origin.name,
      destination: destination.name,
      driving: bundle.driving
        ? {
            eta_minutes: Math.round(bundle.driving.durationSeconds / 60),
            typical_eta_minutes:
              bundle.driving.typicalDurationSeconds === null
                ? null
                : Math.round(bundle.driving.typicalDurationSeconds / 60),
            traffic_delay_minutes: bundle.driving.trafficDelayMinutes,
            distance_km: Math.round(bundle.driving.distanceMeters / 100) / 10,
            share_of_route_congested: bundle.driving.congestionShare,
          }
        : null,
      walking: bundle.walking
        ? {
            eta_minutes: Math.round(bundle.walking.durationSeconds / 60),
            distance_km: Math.round(bundle.walking.distanceMeters / 100) / 10,
          }
        : null,
      predictive_traffic_available: bundle.predictiveTrafficAvailable,
      future_driving_departures: bundle.futureDepartures.map((entry) => ({
        leave_in_minutes: entry.offsetMinutes,
        eta_minutes: Math.round(entry.durationSeconds / 60),
        minutes_better_than_leaving_now: Math.round(
          (primary.durationSeconds - entry.durationSeconds) / 60,
        ),
      })),
      // When the provider gives us no predictive traffic, live-vs-typical is
      // the honest proxy for "is this getting better or worse?".
      traffic_vs_typical_note: bundle.predictiveTrafficAvailable
        ? null
        : describeTrafficTrend(bundle.driving),
      weather_available: weather.samples.length > 0,
      weather_along_route: {
        summary: weather.summary,
        rain_expected_on_route: weather.rainExpectedOnRoute,
        max_rain_probability_pct: weather.maxPrecipitationProbabilityPct,
        rain_starts_in_minutes: weather.rainStartsInMinutes,
        rain_clears_in_minutes: weather.rainClearsInMinutes,
        sampled_points: weather.samples.map((sample) => ({
          where: sample.label,
          arrive_in_minutes: sample.minutesFromNow,
          condition: sample.condition,
          temperature_c: sample.temperatureC,
          rain_probability_pct: sample.precipitationProbabilityAtArrivalPct,
          rain_mm: sample.precipitationAtArrivalMm,
        })),
      },
    };
  }
}

function summarise(route: RouteOption | null): ModeSummary | null {
  if (!route) return null;

  return {
    mode: route.mode,
    etaMinutes: Math.round(route.durationSeconds / 60),
    typicalEtaMinutes:
      route.typicalDurationSeconds === null ? null : Math.round(route.typicalDurationSeconds / 60),
    trafficDelayMinutes: route.trafficDelayMinutes,
    distanceKm: Math.round(route.distanceMeters / 100) / 10,
    congestionShare: route.congestionShare,
  };
}

function describeTrafficTrend(driving: RouteOption | null): string | null {
  if (!driving || driving.trafficDelayMinutes === null) return null;

  const delay = driving.trafficDelayMinutes;
  if (delay <= 1) return 'Traffic is at or below typical levels for this time of week.';
  if (delay < 5) return `Traffic is ${delay} min worse than typical, which is a normal fluctuation.`;
  return `Traffic is ${delay} min worse than typical for this time of week, so it is unusually congested and may ease.`;
}

/** Groups a trip so a repeat request within ~1km reuses the same cache slot. */
function buildCacheKey(deviceId: string, request: RecommendationRequest): string {
  const origin = `${request.origin.lat.toFixed(2)},${request.origin.lon.toFixed(2)}`;
  const destination = `${request.destination.lat.toFixed(4)},${request.destination.lon.toFixed(4)}`;
  return `${deviceId}|${origin}|${destination}`;
}

function localTimeParts(timezone?: string): { time: string; day: string } {
  const now = new Date();

  const format = (options: Intl.DateTimeFormatOptions): string => {
    try {
      return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: timezone }).format(now);
    } catch {
      // An unrecognised IANA zone from the client must not break the request.
      return new Intl.DateTimeFormat('en-GB', options).format(now);
    }
  };

  return {
    time: format({ hour: '2-digit', minute: '2-digit', hour12: false }),
    day: format({ weekday: 'long' }),
  };
}
