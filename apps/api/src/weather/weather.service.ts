import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchJson } from '../common/http.util';
import { pointsAlongRoute } from '../common/geo.util';
import { describeWeatherCode, isWetCode } from './wmo-codes';
import type { PrecipitationTick, RouteWeather, RouteWeatherSample } from './weather.types';

/** A bucket counts as wet at or above either of these. */
const RAIN_PROBABILITY_THRESHOLD_PCT = 50;
const RAIN_AMOUNT_THRESHOLD_MM = 0.2;

/** How far ahead we look when answering "when does the rain start/stop?". */
const RAIN_HORIZON_MINUTES = 90;

const BUCKET_SECONDS = 15 * 60;

interface OpenMeteoLocation {
  latitude: number;
  longitude: number;
  current?: {
    time: number;
    temperature_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    precipitation?: number;
  };
  minutely_15?: {
    time: number[];
    precipitation?: Array<number | null>;
    precipitation_probability?: Array<number | null>;
    weather_code?: Array<number | null>;
  };
}

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Samples the forecast at several points along the route, at roughly the
   * time the traveller will actually reach each one.
   *
   * This is the piece that separates Move from "check the weather app": a
   * 40-minute drive can start dry and end in a downpour, and endpoint-only
   * weather cannot see that. Open-Meteo accepts batched coordinates, so all
   * sample points cost exactly one HTTP round trip - which matters when the
   * user is on a weak mobile connection.
   */
  async getRouteWeather(
    geometry: Array<[number, number]>,
    durationSeconds: number,
  ): Promise<RouteWeather> {
    const fractions = chooseSampleFractions(durationSeconds);
    const labels = labelsFor(fractions.length);
    const points = pointsAlongRoute(geometry, fractions);

    if (points.length === 0) {
      throw new Error('Cannot sample weather for an empty route geometry');
    }

    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', points.map((p) => p.lat).join(','));
    url.searchParams.set('longitude', points.map((p) => p.lon).join(','));
    url.searchParams.set(
      'current',
      'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation',
    );
    url.searchParams.set('minutely_15', 'precipitation,precipitation_probability,weather_code');
    url.searchParams.set('forecast_minutely_15', '12');
    url.searchParams.set('timeformat', 'unixtime');
    url.searchParams.set('timezone', 'GMT');
    url.searchParams.set('wind_speed_unit', 'kmh');

    const raw = await fetchJson<OpenMeteoLocation | OpenMeteoLocation[]>(url.toString(), {
      source: 'open-meteo',
      timeoutMs: this.config.get<number>('upstreamTimeoutMs') ?? 8000,
    });

    const locations = Array.isArray(raw) ? raw : [raw];
    const nowSeconds = Math.floor(Date.now() / 1000);

    const samples: RouteWeatherSample[] = [];
    const seriesPerSample: PrecipitationTick[][] = [];

    points.forEach((point, index) => {
      const location = locations[index] ?? locations[locations.length - 1];
      const minutesFromNow = Math.round((point.fraction * durationSeconds) / 60);
      const series = readSeries(location, nowSeconds);
      const arrival = pickBucket(series, minutesFromNow);

      // Describe the sky the traveller will meet on arrival, not the sky
      // there right now - a 40 minute drive is long enough for those to
      // differ, and disagreeing with the "in 34 min" label beside it would
      // undermine the one claim this screen exists to make.
      const arrivalCode = arrival?.weatherCode ?? location?.current?.weather_code ?? null;
      const probability = arrival?.probabilityPct ?? null;
      const amount = arrival?.millimetres ?? null;

      seriesPerSample.push(series);
      samples.push({
        label: labels[index],
        lat: point.lat,
        lon: point.lon,
        fractionAlongRoute: point.fraction,
        minutesFromNow,
        condition: describeWeatherCode(arrivalCode),
        temperatureC: round1(location?.current?.temperature_2m),
        apparentTemperatureC: round1(location?.current?.apparent_temperature),
        windSpeedKph: round1(location?.current?.wind_speed_10m),
        precipitationAtArrivalMm: amount === null ? null : round1(amount),
        precipitationProbabilityAtArrivalPct: probability,
        wet: isWet(amount, probability) || isWetCode(arrivalCode),
      });
    });

    const probabilities = samples
      .map((sample) => sample.precipitationProbabilityAtArrivalPct)
      .filter((value): value is number => value !== null);

    const { rainStartsInMinutes, rainClearsInMinutes } = rainWindow(seriesPerSample);

    return {
      samples,
      maxPrecipitationProbabilityPct: probabilities.length ? Math.max(...probabilities) : null,
      rainExpectedOnRoute: samples.some((sample) => sample.wet),
      rainStartsInMinutes,
      rainClearsInMinutes,
      summary: summarise(samples),
    };
  }
}

function chooseSampleFractions(durationSeconds: number): number[] {
  const minutes = durationSeconds / 60;
  // Short hops genuinely do not need midpoints; long ones do. Sampling more
  // than four points adds prompt noise without changing the decision.
  if (minutes <= 10) return [0, 1];
  if (minutes <= 25) return [0, 0.5, 1];
  return [0, 1 / 3, 2 / 3, 1];
}

function labelsFor(count: number): string[] {
  if (count === 2) return ['Start', 'Destination'];
  if (count === 3) return ['Start', 'Midway', 'Destination'];
  return ['Start', 'A third in', 'Two thirds in', 'Destination'];
}

/**
 * Normalises Open-Meteo's 15-minute series into offsets from now.
 *
 * We match buckets by their timestamp instead of trusting index 0 to be the
 * current interval, so the code stays correct regardless of how the API pads
 * the start of the series.
 */
function readSeries(location: OpenMeteoLocation | undefined, nowSeconds: number): PrecipitationTick[] {
  const block = location?.minutely_15;
  if (!block?.time?.length) return [];

  return block.time
    .map((timestamp, index) => ({
      minutesFromNow: Math.round((timestamp - nowSeconds) / 60),
      millimetres: block.precipitation?.[index] ?? 0,
      probabilityPct: block.precipitation_probability?.[index] ?? null,
      weatherCode: block.weather_code?.[index] ?? null,
    }))
    // Keep the bucket we are currently inside, plus everything ahead of it.
    .filter((tick) => tick.minutesFromNow > -BUCKET_SECONDS / 60);
}

/** The forecast bucket covering the moment the traveller arrives. */
function pickBucket(series: PrecipitationTick[], minutesFromNow: number): PrecipitationTick | null {
  if (series.length === 0) return null;

  const match = series.find(
    (tick) =>
      minutesFromNow >= tick.minutesFromNow &&
      minutesFromNow < tick.minutesFromNow + BUCKET_SECONDS / 60,
  );

  return match ?? series[series.length - 1];
}

function isWet(millimetres: number | null, probabilityPct: number | null): boolean {
  if (probabilityPct !== null && probabilityPct >= RAIN_PROBABILITY_THRESHOLD_PCT) return true;
  if (millimetres !== null && millimetres >= RAIN_AMOUNT_THRESHOLD_MM) return true;
  return false;
}

/**
 * Earliest start and latest clearance of rain anywhere on the route. These two
 * numbers are what let the model say "wait 20 minutes and you miss it" instead
 * of only "it might rain".
 */
function rainWindow(seriesPerSample: PrecipitationTick[][]): {
  rainStartsInMinutes: number | null;
  rainClearsInMinutes: number | null;
} {
  const wetTicks = seriesPerSample
    .flat()
    .filter((tick) => tick.minutesFromNow <= RAIN_HORIZON_MINUTES)
    .filter((tick) => isWet(tick.millimetres, tick.probabilityPct));

  if (wetTicks.length === 0) {
    return { rainStartsInMinutes: null, rainClearsInMinutes: null };
  }

  const starts = Math.min(...wetTicks.map((tick) => tick.minutesFromNow));
  const lastWet = Math.max(...wetTicks.map((tick) => tick.minutesFromNow));
  const clears = lastWet + BUCKET_SECONDS / 60;

  return {
    rainStartsInMinutes: Math.max(0, starts),
    // Only claim it clears if that happens inside the horizon we can see.
    rainClearsInMinutes: clears <= RAIN_HORIZON_MINUTES ? clears : null,
  };
}

function summarise(samples: RouteWeatherSample[]): string {
  if (samples.length === 0) return 'No weather data available for this route.';

  const wet = samples.filter((sample) => sample.wet);
  const start = samples[0];
  const temperature = start.temperatureC === null ? '' : `, ${start.temperatureC}C`;

  if (wet.length === 0) {
    return `${capitalise(start.condition)}${temperature}, no rain expected anywhere on the route.`;
  }

  if (wet.length === samples.length) {
    return `Wet along the whole route${temperature}, ${start.condition} at the start.`;
  }

  return `${capitalise(start.condition)}${temperature}, but rain expected around ${wet
    .map((sample) => sample.label.toLowerCase())
    .join(' and ')}.`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function round1(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}
