import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DestinationsRepository } from '../destinations/destinations.repository';
import { RecommendationService } from '../recommendation/recommendation.service';
import { RecommendationStateRepository } from '../recommendation/recommendation-state.repository';
import { NotificationsService } from './notifications.service';
import type { Advice } from '../recommendation/recommendation.types';

/**
 * If a device has not asked for anything in this long, its last known origin
 * is stale enough that re-checking from it would be misleading.
 */
const MAX_ORIGIN_AGE_HOURS = 6;

/**
 * The proactive half of the product.
 *
 * Every few minutes this re-runs the recommendation for each watched saved
 * destination and pushes a notification only when the answer has genuinely
 * changed for the better. The "only on a change" rule is the whole design: an
 * alert that fires every sweep is noise, and users turn noise off.
 */
@Injectable()
export class NotificationsScheduler implements OnModuleInit {
  private readonly logger = new Logger(NotificationsScheduler.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly destinations: DestinationsRepository,
    private readonly recommendations: RecommendationService,
    private readonly state: RecommendationStateRepository,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    const minutes = this.config.get<number>('notificationCronMinutes') ?? 7;
    const interval = setInterval(() => {
      void this.sweep();
    }, minutes * 60_000);

    this.registry.addInterval('departure-window-sweep', interval);
    this.logger.log(`Departure-window sweep scheduled every ${minutes} min`);
  }

  /** Exposed so the sweep can also be triggered by hand during a demo. */
  async sweep(): Promise<{ checked: number; notified: number }> {
    if (this.running) {
      this.logger.warn('Previous sweep still running, skipping this tick');
      return { checked: 0, notified: 0 };
    }

    this.running = true;
    let checked = 0;
    let notified = 0;

    try {
      const watched = this.destinations.listWatched();

      for (const destination of watched) {
        const origin = this.resolveOrigin(destination.deviceId);
        if (!origin) continue;

        const previous = this.state.findLatestForDestination(
          destination.deviceId,
          destination.id,
        )?.result.advice;

        try {
          const next = await this.recommendations.getRecommendation(destination.deviceId, {
            origin,
            destination: {
              lat: destination.lat,
              lon: destination.lon,
              name: destination.label,
              address: destination.address,
            },
            destinationId: destination.id,
          });
          checked += 1;

          // A stale answer is a replay of what we already told them.
          if (next.stale || !previous) continue;

          if (!windowJustOpened(previous, next.advice)) continue;

          const delivered = await this.notifications.sendToDevice(destination.deviceId, {
            title: `Good time to leave for ${destination.label}`,
            body: next.advice.headline,
            url: '/',
            tag: `move-window-${destination.id}`,
          });

          if (delivered > 0) {
            notified += 1;
            this.logger.log(`Departure window pushed for ${destination.label}`);
          }
        } catch (error) {
          this.logger.warn(`Sweep failed for ${destination.label}: ${String(error)}`);
        }
      }
    } finally {
      this.running = false;
    }

    return { checked, notified };
  }

  /**
   * Sets up a demonstrable "before" state.
   *
   * The departure-window alert deliberately fires only when the answer
   * improves, which is right for users and awkward for a demo: you cannot
   * make real traffic clear on cue. This rewrites the *stored previous*
   * answer for this device to "wait", so the next sweep travels the genuine
   * change-detection path and fires a real notification.
   *
   * Only the starting state is arranged. The verdict that triggers the alert
   * is still computed live from Mapbox, Open-Meteo, and Gemma.
   */
  armForDemo(deviceId: string): { armed: number; destinations: string[] } {
    const watched = this.destinations
      .listWatched()
      .filter((destination) => destination.deviceId === deviceId);

    const byId = new Map(watched.map((destination) => [destination.id, destination.label]));
    const touched: string[] = [];
    let armed = 0;

    for (const stored of this.state.listForDevice(deviceId)) {
      const label = stored.destinationId ? byId.get(stored.destinationId) : undefined;
      if (!label) continue;

      this.state.save(stored.cacheKey, deviceId, stored.destinationId, {
        ...stored.result,
        advice: {
          ...stored.result.advice,
          recommendation: 'wait',
          wait_minutes: 20,
          leave_by_time: null,
          headline: 'Wait 20 minutes, conditions on your route are poor.',
        },
      });

      armed += 1;
      if (!touched.includes(label)) touched.push(label);
    }

    this.logger.log(`Demo armed for ${deviceId}: ${armed} stored answer(s) set to "wait"`);
    return { armed, destinations: touched };
  }

  private resolveOrigin(deviceId: string): { lat: number; lon: number } | null {
    const latest = this.state.findLatestForDevice(deviceId);
    if (!latest) return null;

    const ageHours = (Date.now() - new Date(latest.createdAt).getTime()) / 3_600_000;
    if (ageHours > MAX_ORIGIN_AGE_HOURS) return null;

    return { lat: latest.result.origin.lat, lon: latest.result.origin.lon };
  }
}

/**
 * True only for a transition worth interrupting someone for: the trip became
 * possible now, or a bounded window appeared where there was none.
 */
function windowJustOpened(previous: Advice, next: Advice): boolean {
  if (previous.recommendation === next.recommendation) return false;

  if (next.recommendation === 'leave_now') return true;
  if (previous.recommendation === 'wait' && next.recommendation === 'leave_by') return true;

  return false;
}
