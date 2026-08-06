import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { resolveDatabaseUrl, sslConfig } from "./resolve-url";

const { Pool } = pg;

// Parse the resolved pooler URL into explicit connection properties.
//
// We deliberately avoid passing only `connectionString` because Replit
// auto-injects PGUSER=postgres / PGHOST=helium / PGPORT=5432 for its
// built-in database, and pg@8 treats those env-var defaults as higher
// priority than a parsed connection string.  Explicit Pool config
// properties always win over PG* env vars, so we pass each field
// individually to ensure pg targets Supabase, not the Replit built-in DB.
//
// Transaction-mode pooler (port 6543): Supabase only holds a real server
// connection during an active query or transaction — idle slots in this
// local pool cost nothing on the Supabase side.  max:5 is plenty;
// idleTimeoutMillis is kept short (10 s) so unused slots are released
// promptly instead of sitting in the pool and appearing as "in-use"
// connections to Supabase.
function buildPoolConfig() {
  const connStr = resolveDatabaseUrl();
  try {
    const u = new URL(connStr);
    return {
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      host: u.hostname,
      port: u.port ? parseInt(u.port, 10) : 6543,
      database: u.pathname.replace(/^\//, ""),
      ssl: sslConfig,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    };
  } catch {
    // Non-parseable URL (e.g. a bare keyword string) — fall back to passing
    // it as a connection string and let pg report any error.
    return {
      connectionString: connStr,
      ssl: sslConfig,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    };
  }
}

export const pool = new Pool(buildPoolConfig());

// node-postgres emits 'error' on the Pool whenever an *idle* client's
// underlying socket dies (e.g. the pooler recycles a connection, a network
// blip, Supabase's transaction pooler closing a slot server-side). With no
// listener registered, that event has no default handler and Node treats it
// as an uncaught exception, killing the whole process (confirmed via a
// Sentry crash: "Error: Connection terminated unexpectedly", mechanism
// auto.node.onuncaughtexception, culprit pg's Connection2/Client). Since the
// pool transparently replaces the dead idle client on the next checkout,
// logging here (not rethrowing) is the correct, non-fatal response.
pool.on("error", (err) => {
  console.error(
    "[db] pool error on idle client (non-fatal, pool recovers automatically):",
    err,
  );
});

export const db = drizzle(pool, { schema });

export * from "./schema";
export {
  resolveDatabaseUrl,
  resolveProductionDatabaseUrl,
  sslConfig,
} from "./resolve-url";
export { STATEMENTS } from "./schema-statements";
