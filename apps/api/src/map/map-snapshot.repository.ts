import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../persistence/database.service';
import type { Coordinates } from '../common/geo.types';

export interface MapSnapshot {
  id: string;
  /** One encoded sub-path per stretch between weather sample points. */
  segments: Array<{ polyline: string; wet: boolean }>;
  /** The whole route in one encoded path, for the URL-too-long fallback. */
  fallbackPolyline: string;
  origin: Coordinates;
  destination: Coordinates;
}

/** Snapshots are only needed while a card is on screen. */
const RETENTION_HOURS = 24;

/**
 * Holds the route shape behind an opaque id.
 *
 * The client gets `/api/map/<id>.png` rather than a Mapbox URL, which is what
 * keeps the access token on the server. Storing the shape also means the image
 * can be re-rendered without asking the routing provider for the route again.
 */
@Injectable()
export class MapSnapshotRepository {
  private readonly logger = new Logger(MapSnapshotRepository.name);

  constructor(private readonly database: DatabaseService) {}

  save(snapshot: MapSnapshot): void {
    this.database
      .prepare(
        `INSERT INTO map_snapshots (id, payload_json, created_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json`,
      )
      .run(snapshot.id, JSON.stringify(snapshot), new Date().toISOString());

    this.prune();
  }

  find(id: string): MapSnapshot | null {
    const row = this.database
      .prepare('SELECT payload_json FROM map_snapshots WHERE id = ?')
      .get(id) as { payload_json: string } | undefined;

    if (!row) return null;

    try {
      return JSON.parse(row.payload_json) as MapSnapshot;
    } catch (error) {
      this.logger.warn(`Discarding corrupt map snapshot ${id}: ${String(error)}`);
      return null;
    }
  }

  private prune(): void {
    const cutoff = new Date(Date.now() - RETENTION_HOURS * 3_600_000).toISOString();
    this.database.prepare('DELETE FROM map_snapshots WHERE created_at < ?').run(cutoff);
  }
}
