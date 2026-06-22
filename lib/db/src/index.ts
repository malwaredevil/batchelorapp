import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { resolveDatabaseUrl, sslConfig } from "./resolve-url";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: resolveDatabaseUrl(),
  ssl: sslConfig,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export { resolveDatabaseUrl, sslConfig } from "./resolve-url";
export { STATEMENTS } from "./schema-statements";
