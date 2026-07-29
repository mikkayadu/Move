import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { PlacesModule } from '../places/places.module';
import { RoutingModule } from '../routing/routing.module';
import { WeatherModule } from '../weather/weather.module';
import { RecommendationController } from './recommendation.controller';
import { RecommendationService } from './recommendation.service';
import { RecommendationStateRepository } from './recommendation-state.repository';

@Module({
  imports: [RoutingModule, PlacesModule, WeatherModule, LlmModule],
  controllers: [RecommendationController],
  providers: [RecommendationService, RecommendationStateRepository],
  exports: [RecommendationService, RecommendationStateRepository],
})
export class RecommendationModule {}
