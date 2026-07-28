import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { DeviceId } from '../common/device-id.decorator';
import { CreateRecommendationDto } from './recommendation.dto';
import { RecommendationService } from './recommendation.service';
import type { RecommendationResult } from './recommendation.types';

@Controller('recommendation')
export class RecommendationController {
  constructor(private readonly recommendation: RecommendationService) {}

  /** The single endpoint behind the whole product. */
  @Post()
  @HttpCode(200)
  create(
    @DeviceId() deviceId: string,
    @Body() body: CreateRecommendationDto,
  ): Promise<RecommendationResult> {
    return this.recommendation.getRecommendation(deviceId, {
      origin: { lat: body.origin.lat, lon: body.origin.lon },
      destination: {
        lat: body.destination.lat,
        lon: body.destination.lon,
        name: body.destination.name,
        address: body.destination.address,
      },
      timezone: body.timezone,
      destinationId: body.destinationId,
    });
  }
}
