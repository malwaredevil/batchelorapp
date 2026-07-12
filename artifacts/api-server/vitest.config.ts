import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Provide a dummy DATABASE_URL so @workspace/db can be imported without
    // throwing in CI (where no real DB is provisioned). Tests mock `db` via
    // vi.mock("@workspace/db") so no actual Postgres connection is ever made.
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://test:test@localhost:5432/testdb",
    },
  },
});
