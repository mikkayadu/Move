import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../persistence/database.service';
import type { RecommendationResult } from './recommendation.types';

export interface StoredRecommendation {
  result: RecommendationResult;
  createdAt: string;
}

/**
 * The last good answer for a given trip.
 *
 * This one table does double duty: it is the fallback that keeps the app
 * useful when Mapbox, Open-Meteo, or the model is unreachable, and it is the
 * "what did we say last time" memory that lets the background job notice when
 * a departure window has opened.
 */
@Injectable()
export class RecommendationStateRepository {
  private readonly logger = new Logger(RecommendationStateRepository.name);

  constructor(private readonly database: DatabaseService) {}

  save(
    cacheKey: string,
    deviceId: string,
    destinationId: string | null,
    result: RecommendationResult,
  ): void {
    this.database
      .prepare(
        `INSERT INTO recommendation_state (cache_key, device_id, destination_id, result_json, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           result_json = excluded.result_json,
           created_at  = excluded.created_at,
           destination_id = excluded.destination_id`,
      )
      .run(cacheKey, deviceId, destinationId, JSON.stringify(result), new Date().toISOString());
  }

  find(cacheKey: string): StoredRecommendation | null {
    const row = this.database
      .prepare('SELECT result_json, created_at FROM recommendation_state WHERE cache_key = ?')
      .get(cacheKey) as { result_json: string; created_at: string } | undefined;

    return this.hydrate(row);
  }

  /**
   * Looser fallback used when the exact trip has never been seen: any recent
   * answer for the same saved destination beats showing an error screen.
   */
  findLatestForDestination(deviceId: string, destinationId: string): StoredRecommendation | null {
    const row = this.database
      .prepare(
        `SELECT result_json, created_at FROM recommendation_state
         WHERE device_id = ? AND destination_id = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(deviceId, destinationId) as { result_json: string; created_at: string } | undefined;

    return this.hydrate(row);
  }

  /** Every stored answer for a device, newest first. */
  listForDevice(deviceId: string): Array<StoredRecommendation & { cacheKey: string; destinationId: string | null }> {
    const rows = this.database
      .prepare(
        `SELECT cache_key, destination_id, result_json, created_at FROM recommendation_state
         WHERE device_id = ? ORDER BY created_at DESC`,
      )
      .all(deviceId) as unknown as Array<{
      cache_key: string;
      destination_id: string | null;
      result_json: string;
      created_at: string;
    }>;

    return rows.flatMap((row) => {
      const stored = this.hydrate(row);
      if (!stored) return [];
      return [{ ...stored, cacheKey: row.cache_key, destinationId: row.destination_id }];
    });
  }

  /**
   * The most recent answer for a device, whatever the trip.
   *
   * The background job uses this purely to recover a plausible origin: a phone
   * asleep in a pocket cannot report GPS, so "wherever you last asked from" is
   * the best available starting point for a re-check.
   */
  findLatestForDevice(deviceId: string): StoredRecommendation | null {
    const row = this.database
      .prepare(
        `SELECT result_json, created_at FROM recommendation_state
         WHERE device_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(deviceId) as { result_json: string; created_at: string } | undefined;

    return this.hydrate(row);
  }

  private hydrate(
    row: { result_json: string; created_at: string } | undefined,
  ): StoredRecommendation | null {
    if (!row) return null;

    try {
      return { result: JSON.parse(row.result_json) as RecommendationResult, createdAt: row.created_at };
    } catch (error) {
      this.logger.warn(`Discarding corrupt cached recommendation: ${String(error)}`);
      return null;
    }
  }
}
