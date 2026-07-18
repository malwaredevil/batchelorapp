import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { resolveDatabaseUrl, sslConfig } from "./resolve-url";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: resolveDatabaseUrl(),
  ssl: sslConfig,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle(pool, { schema });
