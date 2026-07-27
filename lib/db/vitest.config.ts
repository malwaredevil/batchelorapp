import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Provide a dummy DATABASE_URL so resolveDatabaseUrl() tests that don't
    // override the env themselves can import the module without throwing.
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://postgres:test@db.testref.supabase.co:5432/postgres",
    },
  },
});
