import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush, { WebPushError } from 'web-push';
import { PushSubscriptionRepository, StoredPushSubscription } from './push-subscription.repository';

export interface PushPayload {
  title: string;
  body: string;
  /** Deep-link path opened when the notification is tapped. */
  url?: string;
  /** Collapses repeat alerts about the same destination. */
  tag?: string;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private enabled = false;

  constructor(
    private readonly config: ConfigService,
    private readonly subscriptions: PushSubscriptionRepository,
  ) {}

  onModuleInit(): void {
    const vapid = this.config.get<{ publicKey: string; privateKey: string; subject: string }>('vapid');

    if (!vapid?.publicKey || !vapid.privateKey) {
      this.logger.warn(
        'VAPID keys are not set, so push notifications are disabled. ' +
          'Run `npm run keys` and paste the pair into .env to enable them.',
      );
      return;
    }

    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    this.enabled = true;
    this.logger.log('Web Push enabled');
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get publicKey(): string {
    return this.config.get<{ publicKey: string }>('vapid')?.publicKey ?? '';
  }

  subscribe(deviceId: string, subscription: StoredPushSubscription): void {
    this.subscriptions.upsert(deviceId, subscription);
  }

  unsubscribe(endpoint: string): void {
    this.subscriptions.remove(endpoint);
  }

  /**
   * Sends to every device registered under this id. Expired endpoints are
   * pruned as we discover them, which is the only reliable way to learn that
   * a browser has revoked a subscription.
   */
  async sendToDevice(deviceId: string, payload: PushPayload): Promise<number> {
    if (!this.enabled) return 0;

    const targets = this.subscriptions.listForDevice(deviceId);
    const body = JSON.stringify(payload);
    let delivered = 0;

    await Promise.all(
      targets.map(async (target) => {
        try {
          await webpush.sendNotification(target, body);
          delivered += 1;
        } catch (error) {
          if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
            this.logger.log('Pruning expired push subscription');
            this.subscriptions.remove(target.endpoint);
            return;
          }
          this.logger.warn(`Push delivery failed: ${String(error)}`);
        }
      }),
    );

    return delivered;
  }
}
