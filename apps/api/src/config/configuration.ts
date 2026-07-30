/**
 * Central, typed view of every environment variable the API reads.
 *
 * Nothing else in the codebase touches `process.env` directly, so the set of
 * required secrets is discoverable from exactly one file.
 */
export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigins: string[];
  databasePath: string;
  upstreamTimeoutMs: number;
  llmTimeoutMs: number;
  notificationCronMinutes: number;
  googleAiApiKey: string;
  gemmaModel: string;
  mapboxAccessToken: string;
  /** Mapbox style and pixel size for the static route image. */
  mapStyle: string;
  mapSize: string;
  /** Where destination search looks, and which provider answers it. */
  search: {
    /** ISO 3166-1 alpha-2. Results outside this country are discarded. */
    countryCode: string;
    /** "west,south,east,north" passed to the geocoder to narrow the index. */
    bbox: string;
    photonUrl: string;
  };
  vapid: {
    publicKey: string;
    privateKey: string;
    subject: string;
  };
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * CORS comparison is exact, so a bare hostname would silently reject every
 * browser request. Render's `fromService` reference yields a hostname with no
 * scheme, so we add the one it must have been: anything not on localhost is
 * served over HTTPS, which service workers and Web Push require anyway.
 */
function toOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/$/, '');
  if (!trimmed || trimmed === '*' || /^https?:\/\//i.test(trimmed)) return trimmed;
  return `${trimmed.startsWith('localhost') ? 'http' : 'https'}://${trimmed}`;
}

export default (): AppConfig => ({
  port: toInt(process.env.PORT, 3001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map(toOrigin)
    .filter(Boolean),
  databasePath: process.env.DATABASE_PATH ?? './data/move.sqlite',
  upstreamTimeoutMs: toInt(process.env.UPSTREAM_TIMEOUT_MS, 8000),
  llmTimeoutMs: toInt(process.env.LLM_TIMEOUT_MS, 20000),
  notificationCronMinutes: toInt(process.env.NOTIFICATION_CRON_MINUTES, 7),
  googleAiApiKey: process.env.GOOGLE_AI_API_KEY ?? '',
  gemmaModel: process.env.GEMMA_MODEL ?? 'gemma-4-e4b-it',
  mapboxAccessToken: process.env.MAPBOX_ACCESS_TOKEN ?? '',
  // Navigation styles paint their own traffic colours, which would compete
  // with the green/blue used here to mean dry/wet.
  mapStyle: process.env.MAP_STYLE ?? 'dark-v11',
  // Retina doubles the byte cost for a picture that is glanced at, so the
  // default stays at 1x. "640x360@2x" is available if you want it crisper.
  mapSize: process.env.MAP_SIZE ?? '640x360',
  search: {
    countryCode: process.env.SEARCH_COUNTRY_CODE ?? 'GH',
    // Ghana, west/south/east/north.
    bbox: process.env.SEARCH_BBOX ?? '-3.26,4.71,1.21,11.18',
    photonUrl: (process.env.PHOTON_URL ?? 'https://photon.komoot.io').replace(/\/$/, ''),
  },
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? 'mailto:hello@move.app',
  },
});
