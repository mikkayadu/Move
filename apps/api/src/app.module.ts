import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { HealthController } from './health.controller';
import { PersistenceModule } from './persistence/persistence.module';
import { RoutingModule } from './routing/routing.module';
import { WeatherModule } from './weather/weather.module';
import { LlmModule } from './llm/llm.module';
import { RecommendationModule } from './recommendation/recommendation.module';
import { DestinationsModule } from './destinations/destinations.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // The monorepo keeps one .env at the root; the local path is the
      // fallback for a container that mounts config next to the app.
      envFilePath: ['../../.env', '.env'],
    }),
    ScheduleModule.forRoot(),
    PersistenceModule,
    RoutingModule,
    WeatherModule,
    LlmModule,
    RecommendationModule,
    DestinationsModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
