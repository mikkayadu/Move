import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GemmaService } from './llm/gemma.service';
import { NotificationsService } from './notifications/notifications.service';

/**
 * Answers "is this thing actually configured?" in one request, which saves a
 * lot of guessing when the demo is being set up on someone else's machine.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly gemma: GemmaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  status(): Record<string, unknown> {
    return {
      status: 'ok',
      time: new Date().toISOString(),
      model: this.gemma.model,
      configured: {
        gemma: this.gemma.configured,
        mapbox: Boolean(this.config.get<string>('mapboxAccessToken')),
        // Open-Meteo needs no key at all, which is exactly why it was chosen.
        weather: true,
        push: this.notifications.isEnabled,
      },
    };
  }
}
