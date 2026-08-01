import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Provide dummy values for every required() env var so env.ts and auth.ts
    // can be imported during test collection in CI without throwing.
    // Tests mock @workspace/db (via vi.mock) so no actual DB/service calls
    // are ever made — these values only prevent startup-time throws.
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://test:test@localhost:5432/testdb",
      SESSION_SECRET:
        process.env.SESSION_SECRET ?? "ci-test-session-secret-placeholder",
      SUPABASE_URL: process.env.SUPABASE_URL ?? "https://ci-test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY:
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? "ci-test-service-role-key",
      OPENROUTER_API_KEY:
        process.env.OPENROUTER_API_KEY ?? "ci-test-openrouter-key",
      OAUTH_TOKEN_ENCRYPTION_KEY:
        process.env.OAUTH_TOKEN_ENCRYPTION_KEY ??
        "ci-test-oauth-encryption-key-32b",
    },
  },
});
