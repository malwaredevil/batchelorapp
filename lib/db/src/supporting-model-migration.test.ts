import { describe, expect, it } from "vitest";
import { STATEMENTS } from "./schema-statements";

const migration = STATEMENTS.find((statement) =>
  statement.includes("AS replacements(role, old_model, new_model)"),
);

describe("supporting model rollout SQL guardrails", () => {
  it("migrates only the six approved supporting roles", () => {
    expect(migration).toBeDefined();
    const roles = [
      ...(migration ?? "").matchAll(/\('(\w+)', '[^']+', '[^']+'\)/g),
    ].map((match) => match[1]);
    expect(roles).toEqual([
      "fastVision",
      "smartVision",
      "advisor",
      "openAIBalanced",
      "openAIFast",
      "rerank",
    ]);
    expect(migration).toContain("WHERE extra_models->>role = old_model");
  });

  it("preserves custom fusion models and their order", () => {
    expect(migration).toContain(
      "jsonb_typeof(extra_models->'fusionModels') = 'array'",
    );
    expect(migration).toContain(
      `CASE WHEN model = '"anthropic/claude-opus-4.8"'::jsonb`,
    );
    expect(migration).toContain(
      `THEN '"anthropic/claude-opus-5.5"'::jsonb ELSE model END`,
    );
    expect(migration).toContain("ORDER BY ordinal");
  });

  it("guards later owner overrides and avoids repeated updates", () => {
    expect(migration).toContain(
      "WHERE id = 1 AND updated_at < TIMESTAMPTZ '2026-10-03T10:52:22Z'",
    );
    expect(migration).toContain(
      "config.extra_models IS DISTINCT FROM upgraded.models",
    );
    expect(migration).not.toContain("updated_at = NOW()");
    expect(migration).not.toMatch(
      /SET[\s\S]*\b(chat_model|subagent_model|features|thresholds|timeouts)\s*=/,
    );
  });
});
