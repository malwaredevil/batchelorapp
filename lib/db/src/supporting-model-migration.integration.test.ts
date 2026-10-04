/**
 * Opt-in executable PostgreSQL regression tests. Only temporary tables are
 * written; every fixture runs in a rolled-back transaction.
 *
 * RUN_MODEL_MIGRATION_INTEGRATION=1 pnpm --filter @workspace/db exec vitest run \
 *   src/supporting-model-migration.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { STATEMENTS } from "./schema-statements";

const migrations = STATEMENTS.filter(
  (statement) =>
    statement.includes("TIMESTAMPTZ '2026-09-22T16:58:00Z'") ||
    statement.includes("AS replacements(role, old_model, new_model)"),
).map((statement) =>
  // Never target the real configuration, even if the search path changes.
  statement.replace(
    /\belaine_global_config\b/g,
    "pg_temp.elaine_global_config",
  ),
);

const legacy = {
  fastVision: "google/gemini-2.5-flash",
  smartVision: "google/gemini-2.5-flash",
  advisor: "anthropic/claude-opus-4.8",
  openAIBalanced: "gpt-5.6-terra",
  openAIFast: "gpt-5.6-luna",
  rerank: "rerank-2.5",
  fusionModels: [
    "custom/advisor",
    "anthropic/claude-opus-4.8",
    "openai/gpt-5.1",
  ],
  openAIReasoning: "gpt-5.6-sol",
  expertPanelAlt: "openai/gpt-5.1",
  customRole: "unchanged",
};
const upgraded = {
  ...legacy,
  fastVision: "google/gemini-3.8-flash",
  smartVision: "google/gemini-3.8-flash",
  advisor: "anthropic/claude-opus-5.5",
  openAIBalanced: "gpt-6.1-sol",
  openAIFast: "gpt-6-luna",
  rerank: "rerank-3",
  fusionModels: [
    "custom/advisor",
    "anthropic/claude-opus-5.5",
    "openai/gpt-5.1",
  ],
  openAIReasoning: "gpt-6-astra",
  expertPanelAlt: "openai/gpt-6-astra",
};

const fixtures = [
  {
    name: "pre-Astra restore upgrades both rollouts",
    stored: legacy,
    expected: upgraded,
    updatedAt: "2026-09-01T00:00:00Z",
  },
  {
    name: "custom supporting choices and fusion order survive both rollouts",
    stored: { ...legacy, fastVision: "custom/vision", rerank: "custom/rerank" },
    expected: {
      ...upgraded,
      fastVision: "custom/vision",
      rerank: "custom/rerank",
    },
    updatedAt: "2026-09-01T00:00:00Z",
  },
  {
    name: "post-Astra rollback survives while eligible supporting roles upgrade",
    stored: legacy,
    expected: {
      ...upgraded,
      openAIReasoning: legacy.openAIReasoning,
      expertPanelAlt: legacy.expertPanelAlt,
    },
    updatedAt: "2026-09-28T00:00:00Z",
  },
  {
    name: "post-approval supporting rollback survives",
    stored: legacy,
    expected: legacy,
    updatedAt: "2026-10-03T10:53:00Z",
  },
  {
    name: "Astra-only legacy row remains stable when supporting keys are absent",
    stored: { openAIReasoning: "gpt-5.6-sol" },
    expected: { openAIReasoning: "gpt-6-astra" },
    updatedAt: "2026-09-01T00:00:00Z",
  },
  {
    name: "empty configuration remains unchanged",
    stored: {},
    expected: {},
    updatedAt: "2026-09-01T00:00:00Z",
  },
];

describe.runIf(process.env.RUN_MODEL_MIGRATION_INTEGRATION === "1")(
  "ordered model rollouts against isolated PostgreSQL fixtures",
  () => {
    let pool: Pool;
    beforeAll(async () => {
      pool = (await import("./index")).pool;
    });
    afterAll(async () => {
      await pool?.end();
    });

    it.each(fixtures)(
      "$name, including repeat-run stability",
      async (fixture) => {
        expect(migrations).toHaveLength(2);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`
          CREATE TEMP TABLE elaine_global_config (
            id integer PRIMARY KEY,
            extra_models jsonb NOT NULL,
            updated_at timestamptz NOT NULL,
            chat_model text DEFAULT 'google/gemini-2.5-flash',
            subagent_model text DEFAULT 'z-ai/glm-5.2',
            features jsonb DEFAULT '{"preserve":true}'
          ) ON COMMIT DROP
        `);
          await client.query(
            `INSERT INTO pg_temp.elaine_global_config
             (id, extra_models, updated_at) VALUES (1, $1::jsonb, $2::timestamptz)`,
            [JSON.stringify(fixture.stored), fixture.updatedAt],
          );
          for (const migration of migrations) await client.query(migration);
          const read = () =>
            client.query(
              "SELECT *, updated_at::text AS timestamp_text FROM pg_temp.elaine_global_config",
            );
          const first = (await read()).rows[0];
          expect(first.extra_models).toEqual(fixture.expected);
          expect(first.chat_model).toBe("google/gemini-2.5-flash");
          expect(first.subagent_model).toBe("z-ai/glm-5.2");
          expect(first.features).toEqual({ preserve: true });
          expect(first.updated_at.toISOString()).toBe(
            fixture.updatedAt.replace("Z", ".000Z"),
          );
          for (const migration of migrations) await client.query(migration);
          expect((await read()).rows[0]).toEqual(first);
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
      },
    );
  },
);
