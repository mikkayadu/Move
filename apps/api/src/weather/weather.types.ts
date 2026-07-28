export interface PrecipitationTick {
  /** Minutes from now that this 15-minute bucket begins. */
  minutesFromNow: number;
  millimetres: number;
  probabilityPct: number | null;
  /** WMO code forecast for this bucket, not the code observed now. */
  weatherCode: number | null;
}

export interface RouteWeatherSample {
  /** Human label used in the UI and in the model prompt, e.g. "Midway". */
  label: string;
  lat: number;
  lon: number;
  /** 0 at origin, 1 at destination. */
  fractionAlongRoute: number;
  /** Roughly when the traveller reaches this point if they leave now. */
  minutesFromNow: number;
  condition: string;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  windSpeedKph: number | null;
  /** Precipitation forecast for the bucket the traveller actually arrives in. */
  precipitationAtArrivalMm: number | null;
  precipitationProbabilityAtArrivalPct: number | null;
  wet: boolean;
}

export interface RouteWeather {
  samples: RouteWeatherSample[];
  /** Highest arrival-time rain probability anywhere on the route. */
  maxPrecipitationProbabilityPct: number | null;
  /** True when any sampled point expects meaningful rain on arrival. */
  rainExpectedOnRoute: boolean;
  /** Minutes until rain is first expected to start, across the whole route. */
  rainStartsInMinutes: number | null;
  /** Minutes until rain is expected to have cleared everywhere, if it will. */
  rainClearsInMinutes: number | null;
  /** One-line human summary, also handed to the model verbatim. */
  summary: string;
}
