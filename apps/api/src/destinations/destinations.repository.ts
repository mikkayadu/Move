import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../persistence/database.service';
import type { SavedDestination } from './destinations.types';

interface Row {
  id: string;
  label: string;
  address: string;
  lat: number;
  lon: number;
  notify: number;
  created_at: string;
}

@Injectable()
export class DestinationsRepository {
  constructor(private readonly database: DatabaseService) {}

  list(deviceId: string): SavedDestination[] {
    const rows = this.database
      .prepare(
        `SELECT id, label, address, lat, lon, notify, created_at
         FROM saved_destinations WHERE device_id = ? ORDER BY created_at ASC`,
      )
      .all(deviceId) as unknown as Row[];

    return rows.map(toDomain);
  }

  find(deviceId: string, id: string): SavedDestination | null {
    const row = this.database
      .prepare(
        `SELECT id, label, address, lat, lon, notify, created_at
         FROM saved_destinations WHERE device_id = ? AND id = ?`,
      )
      .get(deviceId, id) as unknown as Row | undefined;

    return row ? toDomain(row) : null;
  }

  create(
    deviceId: string,
    input: Omit<SavedDestination, 'id' | 'createdAt'>,
  ): SavedDestination {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.database
      .prepare(
        `INSERT INTO saved_destinations (id, device_id, label, address, lat, lon, notify, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      // node:sqlite binds integers, not booleans.
      .run(id, deviceId, input.label, input.address, input.lat, input.lon, input.notify ? 1 : 0, createdAt);

    return { id, createdAt, ...input };
  }

  setNotify(deviceId: string, id: string, notify: boolean): void {
    this.database
      .prepare('UPDATE saved_destinations SET notify = ? WHERE device_id = ? AND id = ?')
      .run(notify ? 1 : 0, deviceId, id);
  }

  remove(deviceId: string, id: string): void {
    this.database
      .prepare('DELETE FROM saved_destinations WHERE device_id = ? AND id = ?')
      .run(deviceId, id);
  }

  /** Every watched destination across all devices, for the background job. */
  listWatched(): Array<SavedDestination & { deviceId: string }> {
    const rows = this.database
      .prepare(
        `SELECT id, device_id, label, address, lat, lon, notify, created_at
         FROM saved_destinations WHERE notify = 1`,
      )
      .all() as unknown as Array<Row & { device_id: string }>;

    return rows.map((row) => ({ ...toDomain(row), deviceId: row.device_id }));
  }
}

function toDomain(row: Row): SavedDestination {
  return {
    id: row.id,
    label: row.label,
    address: row.address,
    lat: row.lat,
    lon: row.lon,
    notify: row.notify === 1,
    createdAt: row.created_at,
  };
}
