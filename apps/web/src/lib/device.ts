const STORAGE_KEY = 'move.device-id';

/**
 * Move has no accounts. A random id in localStorage is what scopes saved
 * destinations and push subscriptions to this browser, which removes an entire
 * sign-in flow from a product whose whole promise is "one tap".
 */
export function getDeviceId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const id =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  localStorage.setItem(STORAGE_KEY, id);
  return id;
}
