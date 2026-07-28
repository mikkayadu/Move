import { Type } from 'class-transformer';
import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PointDto {
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lon!: number;
}

export class DestinationDto extends PointDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;
}

export class CreateRecommendationDto {
  @ValidateNested()
  @Type(() => PointDto)
  origin!: PointDto;

  @ValidateNested()
  @Type(() => DestinationDto)
  destination!: DestinationDto;

  /** IANA timezone from `Intl.DateTimeFormat().resolvedOptions().timeZone`. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  destinationId?: string;
}
