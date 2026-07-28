import "server-only";
import postgres from "postgres";

// Production data layer = managed PostgreSQL. postgres.js for queries (returns
// plain snake_case rows); Drizzle is used only for schema/migrations.
const g = globalThis as unknown as { __erpSql?: postgres.Sql; __rawSql?: postgres.Sql };

/** Lazily-created, cached postgres.js client. Call inside functions (build-safe). */
export function getSql(): postgres.Sql {
  if (g.__erpSql) return g.__erpSql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add a PostgreSQL connection string (local Postgres in dev, Neon in production).",
    );
  }
  g.__erpSql = postgres(url, {
    max: 5, // serverless-friendly pool size
    idle_timeout: 20,
    prepare: false, // safe with PgBouncer / Neon transaction-mode pooler
  });
  return g.__erpSql;
}

/**
 * Client for the raw Oracle mirror (oracle_raw / oracle_sync_log).
 * Uses ORACLE_RAW_DATABASE_URL when set (dev → Neon, where the synced data
 * lives), otherwise falls back to DATABASE_URL (prod, where both are Neon).
 */
export function getRawSql(): postgres.Sql {
  const url = process.env.ORACLE_RAW_DATABASE_URL;
  if (!url) return getSql();
  if (g.__rawSql) return g.__rawSql;
  g.__rawSql = postgres(url, {
    max: 5,
    idle_timeout: 20,
    prepare: false,
  });
  return g.__rawSql;
}

export { genToken } from "./token";
