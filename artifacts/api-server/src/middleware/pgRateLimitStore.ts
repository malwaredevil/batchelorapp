import type { Store, IncrementResponse, Options } from "express-rate-limit";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { Sentry } from "../lib/sentry";

/**
 * Postgres-backed express-rate-limit Store.
 *
 * The default express-rate-limit store keeps counters in the memory of a
 * single Node process. On the autoscaled deployment, every warm instance has
 * its own independent counters, so an attacker spreading requests across
 * instances gets a fresh budget on each one instead of being held to a single
 * global limit. Backing every limiter with the shared Supabase database
 * closes that gap: all instances read/write the same `rate_limits` rows, so
 * the cap is enforced across the whole deployment, not per-process.
 *
 * `prefix` namespaces keys per limiter (e.g. "login", "ai") so the same
 * client key (IP or user id) does not collide across different limiters that
 * share this store's underlying table.
 */
export class PostgresRateLimitStore implements Store {
  private windowMs = 0;
  readonly prefix: string;
  readonly localKeys = false;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private fullKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  private reportStoreError(operation: string, err: unknown): void {
    logger.warn(
      { err, operation, limiter: this.prefix },
      "rate_limit_store_unavailable",
    );
    Sentry.captureException(err, {
      level: "warning",
      tags: {
        component: "rate_limit_store",
        limiter: this.prefix,
        operation,
      },
    });
  }

  async increment(key: string): Promise<IncrementResponse> {
    try {
      const fullKey = this.fullKey(key);
      const result = await pool.query<{ points: number; reset_at: Date }>(
        `INSERT INTO rate_limits (key, points, reset_at)
         VALUES ($1, 1, now() + ($2 || ' milliseconds')::interval)
         ON CONFLICT (key) DO UPDATE SET
           points = CASE
             WHEN rate_limits.reset_at <= now() THEN 1
             ELSE rate_limits.points + 1
           END,
           reset_at = CASE
             WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at
             ELSE rate_limits.reset_at
           END
         RETURNING points, reset_at`,
        [fullKey, this.windowMs],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("rate_limits upsert returned no row");
      }

      // Opportunistically sweep long-expired rows so the table does not grow
      // unbounded with stale IP/user keys. Cheap, unindexed-write-free, and
      // safe to skip on failure — best-effort housekeeping, not correctness.
      if (Math.random() < 0.01) {
        pool
          .query(
            `DELETE FROM rate_limits WHERE reset_at < now() - interval '1 day'`,
          )
          .catch((err: unknown) => {
            logger.warn({ err }, "rate_limits: sweep of stale rows failed");
          });
      }

      return { totalHits: row.points, resetTime: row.reset_at };
    } catch (err) {
      this.reportStoreError("increment", err);
      throw err;
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await pool.query(
        `UPDATE rate_limits SET points = GREATEST(points - 1, 0) WHERE key = $1`,
        [this.fullKey(key)],
      );
    } catch (err) {
      this.reportStoreError("decrement", err);
      throw err;
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await pool.query(`DELETE FROM rate_limits WHERE key = $1`, [
        this.fullKey(key),
      ]);
    } catch (err) {
      this.reportStoreError("resetKey", err);
      throw err;
    }
  }
}
