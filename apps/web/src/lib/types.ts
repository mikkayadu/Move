export type RecommendationKind = 'leave_now' | 'wait' | 'leave_by';
export type TravelMode = 'driving' | 'walking';

/** The contract Gemma 4 is held to, mirrored from the API. */
export interface Advice {
  recommendation: RecommendationKind;
  leave_by_time: string | null;
  wait_minutes: number | null;
  best_mode: TravelMode;
  headline: string;
  reasoning: string;
  advisory: string | null;
}

export interface Place {
  name: string;
  address: string;
  lat: number;
  lon: number;
}

export interface ModeSummary {
  mode: TravelMode;
  etaMinutes: number;
  typicalEtaMinutes: number | null;
  trafficDelayMinutes: number | null;
  distanceKm: number;
  congestionShare: number | null;
}

export interface WeatherSample {
  label: string;
  lat: number;
  lon: number;
  fractionAlongRoute: number;
  minutesFromNow: number;
  condition: string;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  windSpeedKph: number | null;
  precipitationAtArrivalMm: number | null;
  precipitationProbabilityAtArrivalPct: number | null;
  wet: boolean;
}

export interface RouteWeather {
  samples: WeatherSample[];
  maxPrecipitationProbabilityPct: number | null;
  rainExpectedOnRoute: boolean;
  rainStartsInMinutes: number | null;
  rainClearsInMinutes: number | null;
  summary: string;
}

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
  generatedAt: string;
  stale: boolean;
  staleReason?: string;
}

export interface SavedDestination {
  id: string;
  label: string;
  address: string;
  lat: number;
  lon: number;
  notify: boolean;
  createdAt: string;
}

export interface Coordinates {
  lat: number;
  lon: number;
}
