/**
 * WMO 4677 weather codes as returned by Open-Meteo, reduced to plain English.
 *
 * The description is what reaches the language model, so the wording is chosen
 * to be unambiguous on its own ("heavy rain showers" rather than code 82).
 */
const WMO_DESCRIPTIONS: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'depositing rime fog',
  51: 'light drizzle',
  53: 'moderate drizzle',
  55: 'dense drizzle',
  56: 'light freezing drizzle',
  57: 'dense freezing drizzle',
  61: 'light rain',
  63: 'moderate rain',
  65: 'heavy rain',
  66: 'light freezing rain',
  67: 'heavy freezing rain',
  71: 'light snowfall',
  73: 'moderate snowfall',
  75: 'heavy snowfall',
  77: 'snow grains',
  80: 'light rain showers',
  81: 'moderate rain showers',
  82: 'violent rain showers',
  85: 'light snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with light hail',
  99: 'thunderstorm with heavy hail',
};

export function describeWeatherCode(code: number | null | undefined): string {
  if (code === null || code === undefined) return 'unknown conditions';
  return WMO_DESCRIPTIONS[code] ?? 'unsettled conditions';
}

/** True for codes that make walking genuinely unpleasant or unsafe. */
export function isWetCode(code: number | null | undefined): boolean {
  if (code === null || code === undefined) return false;
  return code >= 51;
}
