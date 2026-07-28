import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

export type PushStatus = 'unsupported' | 'disabled' | 'available' | 'subscribed' | 'denied';

export interface PushState {
  status: PushStatus;
  busy: boolean;
  error: string | null;
  enable: () => Promise<void>;
}

/**
 * Web Push subscription lifecycle.
 *
 * This is what makes Move proactive rather than something you remember to
 * open, and it is also the reason the app is a PWA: push through a service
 * worker is how a web app earns a place on the home screen.
 */
export function usePush(): PushState {
  const [status, setStatus] = useState<PushStatus>('unsupported');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const detect = async (): Promise<void> => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return;
      }

      // The server decides whether push is configured at all.
      const { enabled } = await api.pushPublicKey().catch(() => ({ enabled: false }));
      if (cancelled) return;

      if (!enabled) {
        setStatus('disabled');
        return;
      }
      if (Notification.permission === 'denied') {
        setStatus('denied');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (cancelled) return;

      setStatus(existing ? 'subscribed' : 'available');
    };

    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'available');
        return;
      }

      const { publicKey } = await api.pushPublicKey();
      const registration = await navigator.serviceWorker.ready;

      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      await api.subscribePush(subscription.toJSON());
      setStatus('subscribed');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not enable notifications.');
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, error, enable };
}

/**
 * VAPID keys travel as base64url; PushManager wants raw bytes.
 *
 * The buffer is allocated explicitly so the result is a `Uint8Array<ArrayBuffer>`
 * rather than the wider `ArrayBufferLike`, which `applicationServerKey` rejects.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);

  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}
