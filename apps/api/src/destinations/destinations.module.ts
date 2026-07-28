import { Module } from '@nestjs/common';
import { DestinationsController } from './destinations.controller';
import { DestinationsRepository } from './destinations.repository';

@Module({
  controllers: [DestinationsController],
  providers: [DestinationsRepository],
  exports: [DestinationsRepository],
})
export class DestinationsModule {}
