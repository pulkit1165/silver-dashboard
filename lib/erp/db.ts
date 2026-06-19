import "server-only";
import postgres from "postgres";

// Production data layer = managed PostgreSQL. postgres.js for queries (returns
// plain snake_case rows); Drizzle is used only for schema/migrations.
const g = globalThis as unknown as { __erpSql?: postgres.Sql };

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

export { genToken } from "./token";
