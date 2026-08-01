import { describe, expect, it } from "vitest";
import { getMigrations } from "./manifest";

describe("database migration manifest", () => {
  it("appends reasoning_summary as forward migration version 7", () => {
    const migrations = getMigrations();
    expect(migrations.map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(migrations.at(-1)).toMatchObject({
      version: 7,
      name: "reasoning summary",
    });
    expect(migrations[0]?.checksumSha256).toHaveLength(64);
  });

  it("keeps reasoning_summary migration additive, nullable, and idempotent", () => {
    const migration = getMigrations().find(({ version }) => version === 7)!;
    const sql = migration.statements.join("\n").toLowerCase();
    expect(sql).not.toMatch(/\b(drop|truncate|not null)\b/);
    expect(sql).toContain("if not exists");
    expect(sql).toContain("reasoning_summary");
    expect(sql).toContain("elaine_history_messages");
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
