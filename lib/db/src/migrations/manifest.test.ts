import { describe, expect, it } from "vitest";
import { getMigrations } from "./manifest";

describe("database migration manifest", () => {
  it("appends Responses state as forward migration version 6", () => {
    const migrations = getMigrations();
    expect(migrations.map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(migrations.at(-1)).toMatchObject({
      version: 6,
      name: "openai responses state",
    });
    expect(migrations[0]?.checksumSha256).toHaveLength(64);
  });

  it("keeps Responses state nullable, additive, and idempotent", () => {
    const migration = getMigrations().find(({ version }) => version === 6)!;
    const sql = migration.statements.join("\n").toLowerCase();
    expect(sql).not.toMatch(/\b(drop|truncate|not null)\b/);
    expect(sql).toContain("if not exists");
    expect(sql).toContain("openai_last_response_id");
    expect(sql).toContain("openai_state_model");
    expect(sql).toContain("openai_state_updated_at");
  });

  it("keeps the Elaine migration additive and idempotent", () => {
    const migration = getMigrations().find(({ version }) => version === 5)!;
    const sql = migration.statements.join("\n").toLowerCase();
    expect(sql).not.toMatch(/\b(drop|truncate)\b/);
    expect(sql).toContain("if not exists");
    expect(sql).toContain("elaine_memory_events");
    expect(sql).toContain("source_route");
    expect(sql).toContain("observations");
  });
});
