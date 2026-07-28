import { Controller, Get, Query } from '@nestjs/common';
import { IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { RoutingService } from './routing.service';
import type { Place } from './routing.types';

class SearchQueryDto {
  @IsString()
  @IsNotEmpty()
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lon?: number;
}

class ReverseQueryDto {
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lon!: number;
}

@Controller('places')
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  /** Destination autocomplete for the home screen. */
  @Get('search')
  search(@Query() query: SearchQueryDto): Promise<Place[]> {
    const near =
      query.lat !== undefined && query.lon !== undefined
        ? { lat: query.lat, lon: query.lon }
        : undefined;
    return this.routing.searchPlaces(query.q, near);
  }

  /** Names the user's GPS fix so the UI can show "from <somewhere real>". */
  @Get('reverse')
  reverse(@Query() query: ReverseQueryDto): Promise<Place> {
    return this.routing.describeLocation({ lat: query.lat, lon: query.lon });
  }
}
