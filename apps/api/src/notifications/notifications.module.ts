import { Module } from '@nestjs/common';
import { DestinationsModule } from '../destinations/destinations.module';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsScheduler } from './notifications.scheduler';
import { NotificationsService } from './notifications.service';
import { PushSubscriptionRepository } from './push-subscription.repository';

@Module({
  imports: [DestinationsModule, RecommendationModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushSubscriptionRepository, NotificationsScheduler],
  exports: [NotificationsService],
})
export class NotificationsModule {}
