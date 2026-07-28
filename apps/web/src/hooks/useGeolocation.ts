import { useCallback, useEffect, useState } from 'react';
import type { Coordinates } from '../lib/types';

export type GeolocationStatus = 'locating' | 'ready' | 'error' | 'unsupported';

export interface GeolocationState {
  status: GeolocationStatus;
  position: Coordinates | null;
  error: string | null;
  retry: () => void;
}

/**
 * Wraps the Geolocation API with the two behaviours the product actually needs:
 * a readable error instead of a numeric code, and a retry, because a denied or
 * timed-out fix on a phone is common rather than exceptional.
 */
export function useGeolocation(): GeolocationState {
  const [status, setStatus] = useState<GeolocationStatus>('locating');
  const [position, setPosition] = useState<Coordinates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setStatus('locating');
    setError(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      setError('This browser cannot share your location.');
      return;
    }

    let cancelled = false;

    navigator.geolocation.getCurrentPosition(
      (fix) => {
        if (cancelled) return;
        setPosition({ lat: fix.coords.latitude, lon: fix.coords.longitude });
        setStatus('ready');
      },
      (failure) => {
        if (cancelled) return;
        setStatus('error');
        setError(describe(failure));
      },
      // A cached fix up to a minute old is fine and much faster to obtain.
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { status, position, error, retry };
}

function describe(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Location permission was denied. Move needs it to know where you are starting from.';
    case error.POSITION_UNAVAILABLE:
      return 'Your position could not be determined right now.';
    case error.TIMEOUT:
      return 'Getting a location fix took too long.';
    default:
      return 'Location is unavailable.';
  }
}
