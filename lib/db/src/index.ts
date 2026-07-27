import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { resolveDatabaseUrl, sslConfig } from "./resolve-url";

const { Pool } = pg;

// Transaction-mode pooler (port 6543): Supabase only holds a real server
// connection during an active query or transaction — idle slots in this local
// pool cost nothing on the Supabase side. max:5 is plenty; idleTimeoutMillis
// is kept short (10 s) so unused slots are released promptly instead of
// sitting in the pool and appearing as "in-use" connections to Supabase.
export const pool = new Pool({
  connectionString: resolveDatabaseUrl(),
  ssl: sslConfig,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export { resolveDatabaseUrl, sslConfig } from "./resolve-url";
export { STATEMENTS } from "./schema-statements";
