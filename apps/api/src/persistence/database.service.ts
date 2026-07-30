import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Persistence is Node's built-in `node:sqlite`.
 *
 * The obvious choice would have been TypeORM over better-sqlite3, but that
 * needs a native toolchain to compile. Node 24+ ships SQLite in core, which
 * gives us a real relational store with zero dependencies and zero build step
 * - it cannot fail to install on a teammate's machine or in a slim container.
 * The surface we need (four small tables) does not justify an ORM.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private database?: DatabaseSync;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const configured = this.config.get<string>('databasePath') ?? ':memory:';
    const path = configured === ':memory:' ? ':memory:' : resolve(configured);

    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.database = new DatabaseSync(path);
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
    this.logger.log(`SQLite ready at ${path}`);
  }

  onModuleDestroy(): void {
    this.database?.close();
  }

  get db(): DatabaseSync {
    if (!this.database) throw new Error('Database accessed before initialisation');
    return this.database;
  }

  prepare(sql: string): StatementSync {
    return this.db.prepare(sql);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS saved_destinations (
        id          TEXT PRIMARY KEY,
        device_id   TEXT NOT NULL,
        label       TEXT NOT NULL,
        address     TEXT NOT NULL,
        lat         REAL NOT NULL,
        lon         REAL NOT NULL,
        notify      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_saved_destinations_device
        ON saved_destinations (device_id);

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint    TEXT PRIMARY KEY,
        device_id   TEXT NOT NULL,
        p256dh      TEXT NOT NULL,
        auth        TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_push_subscriptions_device
        ON push_subscriptions (device_id);

      -- Doubles as the graceful-degradation cache and as the change-detection
      -- memory for the proactive notification job.
      CREATE TABLE IF NOT EXISTS recommendation_state (
        cache_key      TEXT PRIMARY KEY,
        device_id      TEXT NOT NULL,
        destination_id TEXT,
        result_json    TEXT NOT NULL,
        created_at     TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_recommendation_state_device
        ON recommendation_state (device_id);

      -- Route shapes behind an opaque id, so the static map can be proxied
      -- without ever handing the Mapbox token to a browser.
      CREATE TABLE IF NOT EXISTS map_snapshots (
        id           TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_map_snapshots_created
        ON map_snapshots (created_at);
    `);
  }
}
