import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../persistence/database.service';

export interface StoredPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface Row {
  endpoint: string;
  p256dh: string;
  auth: string;
}

@Injectable()
export class PushSubscriptionRepository {
  constructor(private readonly database: DatabaseService) {}

  upsert(deviceId: string, subscription: StoredPushSubscription): void {
    this.database
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, device_id, p256dh, auth, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           device_id = excluded.device_id,
           p256dh    = excluded.p256dh,
           auth      = excluded.auth`,
      )
      .run(
        subscription.endpoint,
        deviceId,
        subscription.keys.p256dh,
        subscription.keys.auth,
        new Date().toISOString(),
      );
  }

  listForDevice(deviceId: string): StoredPushSubscription[] {
    const rows = this.database
      .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE device_id = ?')
      .all(deviceId) as unknown as Row[];

    return rows.map((row) => ({
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }));
  }

  remove(endpoint: string): void {
    this.database.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }
}
