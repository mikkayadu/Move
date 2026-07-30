import { getDeviceId } from './device';
import type {
  Coordinates,
  Place,
  RecommendationResult,
  SavedDestination,
} from './types';

/**
 * In development Vite proxies /api to the NestJS process, so the browser stays
 * on one origin. In production VITE_API_BASE_URL points at the deployed API.
 *
 * The scheme is added when missing because Render's blueprint reference
 * supplies a bare hostname, and wiring the two services together
 * automatically is worth more than insisting the variable be perfectly formed.
 */
const BASE = normaliseBase(import.meta.env.VITE_API_BASE_URL ?? '');

function normaliseBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '');
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-device-id': getDeviceId(),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const message =
      (detail as { message?: string | string[] } | null)?.message ??
      `Request failed with status ${response.status}`;
    throw new ApiError(Array.isArray(message) ? message.join(', ') : message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Turns a server-relative path such as "/api/map/<id>.png" into something the
 * browser can load, which in production means prefixing the API origin.
 */
export function absoluteUrl(path: string): string {
  return `${BASE}${path}`;
}

export const api = {
  health: () =>
    request<{ status: string; model: string; configured: Record<string, boolean> }>('/health'),

  searchPlaces: (query: string, near?: Coordinates) => {
    const params = new URLSearchParams({ q: query });
    if (near) {
      params.set('lat', String(near.lat));
      params.set('lon', String(near.lon));
    }
    return request<Place[]>(`/places/search?${params.toString()}`);
  },

  recommendation: (input: {
    origin: Coordinates;
    destination: Coordinates & { name?: string; address?: string };
    destinationId?: string;
  }) =>
    request<RecommendationResult>('/recommendation', {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    }),

  listDestinations: () => request<SavedDestination[]>('/destinations'),

  createDestination: (input: {
    label: string;
    address: string;
    lat: number;
    lon: number;
    notify?: boolean;
  }) => request<SavedDestination>('/destinations', { method: 'POST', body: JSON.stringify(input) }),

  setDestinationNotify: (id: string, notify: boolean) =>
    request<SavedDestination>(`/destinations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ notify }),
    }),

  deleteDestination: (id: string) => request<void>(`/destinations/${id}`, { method: 'DELETE' }),

  pushPublicKey: () => request<{ publicKey: string; enabled: boolean }>('/notifications/public-key'),

  subscribePush: (subscription: PushSubscriptionJSON) =>
    request<void>('/notifications/subscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys }),
    }),

  testPush: () => request<{ delivered: number }>('/notifications/test', { method: 'POST' }),
};
