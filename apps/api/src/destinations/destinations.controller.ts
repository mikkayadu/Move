import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DeviceId } from '../common/device-id.decorator';
import { DestinationsRepository } from './destinations.repository';
import type { SavedDestination } from './destinations.types';

class CreateDestinationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  label!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  address!: string;

  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lon!: number;

  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}

class UpdateNotifyDto {
  @IsBoolean()
  notify!: boolean;
}

@Controller('destinations')
export class DestinationsController {
  constructor(private readonly destinations: DestinationsRepository) {}

  @Get()
  list(@DeviceId() deviceId: string): SavedDestination[] {
    return this.destinations.list(deviceId);
  }

  @Post()
  create(
    @DeviceId() deviceId: string,
    @Body() body: CreateDestinationDto,
  ): SavedDestination {
    return this.destinations.create(deviceId, {
      label: body.label,
      address: body.address,
      lat: body.lat,
      lon: body.lon,
      notify: body.notify ?? true,
    });
  }

  @Patch(':id')
  setNotify(
    @DeviceId() deviceId: string,
    @Param('id') id: string,
    @Body() body: UpdateNotifyDto,
  ): SavedDestination {
    if (!this.destinations.find(deviceId, id)) {
      throw new NotFoundException('Saved destination not found');
    }

    this.destinations.setNotify(deviceId, id, body.notify);
    return this.destinations.find(deviceId, id)!;
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@DeviceId() deviceId: string, @Param('id') id: string): void {
    this.destinations.remove(deviceId, id);
  }
}
