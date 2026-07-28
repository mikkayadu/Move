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

export default (): AppConfig => ({
  port: toInt(process.env.PORT, 3001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  databasePath: process.env.DATABASE_PATH ?? './data/move.sqlite',
  upstreamTimeoutMs: toInt(process.env.UPSTREAM_TIMEOUT_MS, 8000),
  llmTimeoutMs: toInt(process.env.LLM_TIMEOUT_MS, 20000),
  notificationCronMinutes: toInt(process.env.NOTIFICATION_CRON_MINUTES, 7),
  googleAiApiKey: process.env.GOOGLE_AI_API_KEY ?? '',
  gemmaModel: process.env.GEMMA_MODEL ?? 'gemma-4-e4b-it',
  mapboxAccessToken: process.env.MAPBOX_ACCESS_TOKEN ?? '',
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? 'mailto:hello@move.app',
  },
});
