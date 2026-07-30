import { Module } from '@nestjs/common';
import { MapController } from './map.controller';
import { MapSnapshotRepository } from './map-snapshot.repository';
import { StaticMapService } from './static-map.service';

@Module({
  controllers: [MapController],
  providers: [StaticMapService, MapSnapshotRepository],
  exports: [StaticMapService],
})
export class MapModule {}
