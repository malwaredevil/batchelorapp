import * as schema from "./schema";
export declare const pool: import("pg").Pool;
export declare const db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema> & {
    $client: import("pg").Pool;
};
export * from "./schema";
export { resolveDatabaseUrl, sslConfig } from "./resolve-url";
export { STATEMENTS } from "./schema-statements";
//# sourceMappingURL=index.d.ts.map