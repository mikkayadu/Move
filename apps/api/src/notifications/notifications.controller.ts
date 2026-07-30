import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { IsNotEmpty, IsObject, IsString } from 'class-validator';
import { DeviceId } from '../common/device-id.decorator';
import { NotificationsService } from './notifications.service';
import { NotificationsScheduler } from './notifications.scheduler';

class SubscribeDto {
  @IsString()
  @IsNotEmpty()
  endpoint!: string;

  @IsObject()
  keys!: { p256dh: string; auth: string };
}

class UnsubscribeDto {
  @IsString()
  @IsNotEmpty()
  endpoint!: string;
}

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly scheduler: NotificationsScheduler,
  ) {}

  /** The browser needs the VAPID public key before it can subscribe. */
  @Get('public-key')
  publicKey(): { publicKey: string; enabled: boolean } {
    return { publicKey: this.notifications.publicKey, enabled: this.notifications.isEnabled };
  }

  @Post('subscribe')
  @HttpCode(204)
  subscribe(@DeviceId() deviceId: string, @Body() body: SubscribeDto): void {
    this.notifications.subscribe(deviceId, { endpoint: body.endpoint, keys: body.keys });
  }

  @Post('unsubscribe')
  @HttpCode(204)
  unsubscribe(@Body() body: UnsubscribeDto): void {
    this.notifications.unsubscribe(body.endpoint);
  }

  /** Lets the demo prove the push path works without waiting for the cron. */
  @Post('test')
  @HttpCode(200)
  async test(@DeviceId() deviceId: string): Promise<{ delivered: number }> {
    const delivered = await this.notifications.sendToDevice(deviceId, {
      title: 'Move is watching your trips',
      body: 'You will get a nudge here when a good departure window opens.',
      tag: 'move-test',
    });
    return { delivered };
  }

  /**
   * Runs the departure-window sweep immediately instead of waiting for the
   * timer. Nobody wants to stand in front of judges waiting seven minutes.
   */
  @Post('sweep')
  @HttpCode(200)
  sweep(): Promise<{ checked: number; notified: number }> {
    return this.scheduler.sweep();
  }

  /**
   * Demo aid: rewrites this device's stored previous answers to "wait", so
   * the next sweep sees the verdict improve and fires for real.
   *
   * It arranges the "before" state only. The alert itself still comes from a
   * live recommendation, through the same change detection users get.
   */
  @Post('demo/arm')
  @HttpCode(200)
  arm(@DeviceId() deviceId: string): { armed: number; destinations: string[] } {
    return this.scheduler.armForDemo(deviceId);
  }
}
