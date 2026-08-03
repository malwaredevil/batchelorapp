/**
 * Drift/completeness guard for the Elaine/AI Global Config admin panel —
 * analogous to app-config-drift.test.ts for the general Control Panel.
 *
 * Uses text-based static analysis (not runtime Object.keys()) because the
 * runtime defaults for some optional nested fields are `{}` — Object.keys()
 * would miss e.g. features.openAIStoreScopeOverrides.elaine/app entirely.
 * Reading the TypeScript interfaces directly catches every declared field,
 * including nested override sub-fields.
 *
 * Three files are compared:
 *   1. elaine-config.ts     — source of truth: every configurable field.
 *   2. admin-config.ts      — AdminConfigBody Zod schema (the write path).
 *   3. GlobalConfigCard.tsx — the owner panel UI (the edit surface).
 *
 * If this test fails after adding a new configurable field, add it to
 * AdminConfigBody and to GlobalConfigCard.tsx (and vice versa for stale
 * fields removed from one side but not the other).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ELAINE_CONFIG_PATH = join(__dirname, "elaine-config.ts");
const ADMIN_CONFIG_PATH = join(__dirname, "..", "elaine", "admin-config.ts");
const GLOBAL_CONFIG_CARD_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "lib",
  "elaine-ui",
  "src",
  "GlobalConfigCard.tsx",
);

// The interfaces that together define every admin-configurable field.
const CONFIG_INTERFACES = [
  "ExtraModelsConfig",
  "TimeoutsConfig",
  "FeaturesConfig",
  "ThresholdsConfig",
  "ElaineGlobalConfig",
];

function extractInterfaceBlock(source: string, interfaceName: string): string {
  // Non-greedy match up to the first UNINDENTED closing brace, so nested
  // object types (e.g. openAIStoreScopeOverrides: { ... };, indented) don't
  // prematurely terminate the match — their closing "};" is indented, the
  // interface's own closing "}" is not.
  const re = new RegExp(
    `export interface ${interfaceName} \\{([\\s\\S]*?)\\n\\}`,
  );
  const match = source.match(re);
  if (!match) {
    throw new Error(
      `Could not locate "export interface ${interfaceName} { ... }" in elaine-config.ts — was it renamed or restructured? Update this test's parsing accordingly.`,
    );
  }
  return match[1] as string;
}

function extractFieldNamesFromBlock(block: string): string[] {
  const names: string[] = [];
  const fieldRe = /^\s*([A-Za-z0-9_]+)\??:/gm;
  let match: RegExpExecArray | null;
  while ((match = fieldRe.exec(block))) {
    names.push(match[1] as string);
  }
  return names;
}

function extractDefaultsFieldNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const interfaceName of CONFIG_INTERFACES) {
    for (const name of extractFieldNamesFromBlock(
      extractInterfaceBlock(source, interfaceName),
    )) {
      names.add(name);
    }
  }
  // Server-set metadata, never user-editable — deliberately excluded.
  names.delete("updatedAt");
  return names;
}

function extractZodFieldNames(source: string): Set<string> {
  const names = new Set<string>();
  // Matches both `field: z.string()...` (same-line) and `field: z\n  .object(...)`
  // (next-line-chained) styles used in AdminConfigBody.
  const fieldRe = /^\s*([A-Za-z0-9_]+):\s*z\b/gm;
  let match: RegExpExecArray | null;
  while ((match = fieldRe.exec(source))) {
    names.add(match[1] as string);
  }
  return names;
}

describe("Elaine global config completeness (no drift)", () => {
  const defaultsSource = readFileSync(ELAINE_CONFIG_PATH, "utf-8");
  const defaultsFields = extractDefaultsFieldNames(defaultsSource);

  // Sanity check on the parser itself — if this is ever empty, the interface
  // regex silently broke and every other assertion below would be vacuous.
  it("parsed at least the known baseline set of fields from elaine-config.ts", () => {
    expect(defaultsFields.size).toBeGreaterThan(20);
    expect(defaultsFields.has("chatModel")).toBe(true);
    expect(defaultsFields.has("openAIStoreScopeOverrides")).toBe(true);
    // Nested override sub-fields must be captured too, not just the container.
    expect(defaultsFields.has("elaine")).toBe(true);
    expect(defaultsFields.has("app")).toBe(true);
  });

  it("every configurable field in elaine-config.ts has a matching entry in AdminConfigBody (admin-config.ts)", () => {
    const schemaSource = readFileSync(ADMIN_CONFIG_PATH, "utf-8");
    const schemaFields = extractZodFieldNames(schemaSource);

    const missingFromSchema = [...defaultsFields].filter(
      (f) => !schemaFields.has(f),
    );
    expect(
      missingFromSchema,
      `Field(s) added to elaine-config.ts but missing from AdminConfigBody in admin-config.ts: ${missingFromSchema.join(", ")}. Add them to the Zod schema or the owner panel can never save them.`,
    ).toEqual([]);
  });

  it("AdminConfigBody (admin-config.ts) has no stale fields without a matching elaine-config.ts default", () => {
    const schemaSource = readFileSync(ADMIN_CONFIG_PATH, "utf-8");
    const schemaFields = extractZodFieldNames(schemaSource);

    const staleInSchema = [...schemaFields].filter(
      (f) => !defaultsFields.has(f),
    );
    expect(
      staleInSchema,
      `Field(s) in AdminConfigBody with no matching elaine-config.ts default: ${staleInSchema.join(", ")}. Remove the stale field or add the matching default/interface entry.`,
    ).toEqual([]);
  });

  it("every configurable field is referenced somewhere in the owner panel UI (GlobalConfigCard.tsx)", () => {
    const uiSource = readFileSync(GLOBAL_CONFIG_CARD_PATH, "utf-8");

    const missingFromUi = [...defaultsFields].filter(
      (f) => !new RegExp(`\\b${f}\\b`).test(uiSource),
    );
    expect(
      missingFromUi,
      `Field(s) added to elaine-config.ts but not referenced anywhere in GlobalConfigCard.tsx: ${missingFromUi.join(", ")}. Every configurable field must be editable in the owner panel.`,
    ).toEqual([]);
  });
});
