import { describe, expect, it } from "vitest";
import { getMigrations } from "./manifest";

describe("database migration manifest", () => {
  it("appends Elaine wave 3 as forward migration version 5", () => {
    const migrations = getMigrations();
    expect(migrations.map(({ version }) => version)).toEqual([1, 2, 3, 4, 5]);
    expect(migrations.at(-1)).toMatchObject({
      version: 5,
      name: "elaine adaptive intelligence",
    });
    expect(migrations[0]?.checksumSha256).toHaveLength(64);
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
