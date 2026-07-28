import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/**
 * Global so the handful of repositories can inject the connection without
 * every feature module re-importing persistence.
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class PersistenceModule {}
