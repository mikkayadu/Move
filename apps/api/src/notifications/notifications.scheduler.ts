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

        // The last known position has aged out. Watching from a location the
        // user left hours ago produces confident nonsense, so stop.
        if (!origin) {
          this.destinations.setNotify(destination.deviceId, destination.id, false);
          this.logger.log(
            `Stopped watching ${destination.label}: last known location is too old`,
          );
          continue;
        }

        const previous = this.state.findLatestForDestination(
          destination.deviceId,
          destination.id,
        )?.result.advice;

        try {
          const next = await this.recommendations.getRecommendation(destination.deviceId, {
            origin: { lat: origin.lat, lon: origin.lon },
            destination: {
              lat: destination.lat,
              lon: destination.lon,
              name: destination.label,
              address: destination.address,
            },
            destinationId: destination.id,
            originCapturedAt: origin.capturedAt,
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

            // One alert per armed destination, then done. Move cannot see that
            // you have set off - a service worker has no access to location -
            // so continuing to watch risks nagging about a trip already under
            // way or finished. Telling you once is the whole job.
            this.destinations.setNotify(destination.deviceId, destination.id, false);
            this.logger.log(
              `Departure window pushed for ${destination.label}; watching switched off`,
            );
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
   * The device's last reported position, if it is still recent enough to
   * plan from.
   *
   * Age is measured from when the position was *captured*, not from when the
   * row was last written. Those differ because every sweep rewrites the row:
   * measuring the row's age would refresh the very timestamp being checked,
   * and the guard could never fire.
   */
  private resolveOrigin(
    deviceId: string,
  ): { lat: number; lon: number; capturedAt: string } | null {
    const latest = this.state.findLatestForDevice(deviceId);
    if (!latest) return null;

    // Answers stored before this field existed fall back to the row's time.
    const capturedAt = latest.result.originCapturedAt ?? latest.createdAt;
    const ageHours = (Date.now() - new Date(capturedAt).getTime()) / 3_600_000;
    if (!Number.isFinite(ageHours) || ageHours > MAX_ORIGIN_AGE_HOURS) return null;

    return { lat: latest.result.origin.lat, lon: latest.result.origin.lon, capturedAt };
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
