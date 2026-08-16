/**
 * Drift-prevention tests for the `get_owner_settings` tool serializers.
 *
 * WHY: The tool reports Elaine's global AI config and every Control Panel
 * app-config entry.  Because `buildOwnerSettingsElaineSection` and
 * `buildOwnerSettingsAppConfigSection` are pure functions that hand-pick
 * fields, a developer could add a new key to `ELAINE_CONFIG_DEFAULTS` or
 * `APP_CONFIG_DEFAULTS` without updating the serializers — and the report
 * would silently omit the new value.  These tests catch that class of drift:
 *
 *  - The Elaine-config test asserts that every top-level key of
 *    `ELAINE_CONFIG_DEFAULTS` has a corresponding output key in the section
 *    (with the known `updatedAt` → `lastUpdatedAt` rename accounted for).
 *    Adding a new key to `ElaineGlobalConfig`/`ELAINE_CONFIG_DEFAULTS` without
 *    updating `buildOwnerSettingsElaineSection` will cause this test to fail.
 *
 *  - The app-config test mocks `APP_CONFIG_DEFAULTS` and asserts that every
 *    module/key pair appears in `buildOwnerSettingsAppConfigSection`'s output.
 *    This proves the serializer is a pass-through (not a whitelist), so new
 *    rows added to `APP_CONFIG_DEFAULTS` flow through automatically.
 */

import { describe, it, expect } from "vitest";

import {
  buildOwnerSettingsElaineSection,
  buildOwnerSettingsAppConfigSection,
} from "./owner-settings-report";
import {
  ELAINE_CONFIG_DEFAULTS,
  DEFAULT_MODELS,
  DEFAULT_TIMEOUTS,
  DEFAULT_FEATURES,
  DEFAULT_THRESHOLDS,
} from "../lib/elaine-config";
import { APP_CONFIG_DEFAULTS } from "../lib/app-config";

// ---------------------------------------------------------------------------
// Elaine global-config section
// ---------------------------------------------------------------------------

describe("buildOwnerSettingsElaineSection", () => {
  /**
   * The canonical rename map: keys in `ElaineGlobalConfig` (and therefore
   * `ELAINE_CONFIG_DEFAULTS`) that are exposed under a different name in the
   * tool output.  Update this map if a rename is intentional; the test below
   * will guide you to add it here.
   */
  const RENAMED_KEYS: Record<string, string> = {
    updatedAt: "lastUpdatedAt",
  };

  it("includes a key for every property of ELAINE_CONFIG_DEFAULTS", () => {
    const section = buildOwnerSettingsElaineSection(ELAINE_CONFIG_DEFAULTS);

    const defaultKeys = Object.keys(ELAINE_CONFIG_DEFAULTS);
    for (const key of defaultKeys) {
      const outputKey = RENAMED_KEYS[key] ?? key;
      expect(
        Object.prototype.hasOwnProperty.call(section, outputKey),
        `Expected section to have key "${outputKey}" (from ELAINE_CONFIG_DEFAULTS key "${key}"). ` +
          `If this is a new field, add it to buildOwnerSettingsElaineSection in owner-settings-report.ts.`,
      ).toBe(true);
    }
  });

  it("reflects live values from the config object, not hardcoded constants", () => {
    const customCfg = {
      ...ELAINE_CONFIG_DEFAULTS,
      chatModel: "openai/gpt-custom",
      subagentModel: "openai/gpt-sub-custom",
      requestTimeoutMs: 99_999,
      maxResponseTokens: 1234,
    };

    const section = buildOwnerSettingsElaineSection(customCfg);

    expect(section.chatModel).toBe("openai/gpt-custom");
    expect(section.subagentModel).toBe("openai/gpt-sub-custom");
    expect(section.requestTimeoutMs).toBe(99_999);
    expect(section.maxResponseTokens).toBe(1234);
  });

  it("maps updatedAt to lastUpdatedAt", () => {
    const cfgWithTimestamp = {
      ...ELAINE_CONFIG_DEFAULTS,
      updatedAt: "2026-05-01T12:00:00.000Z",
    };
    const section = buildOwnerSettingsElaineSection(cfgWithTimestamp);
    expect(section.lastUpdatedAt).toBe("2026-05-01T12:00:00.000Z");
    expect(
      (section as unknown as Record<string, unknown>).updatedAt,
    ).toBeUndefined();
  });

  it("includes all four nested config groups (models / timeouts / features / thresholds)", () => {
    const section = buildOwnerSettingsElaineSection(ELAINE_CONFIG_DEFAULTS);
    // Each group should be the same object reference (no deep clone needed for a read-only report).
    expect(section.models).toEqual(DEFAULT_MODELS);
    expect(section.timeouts).toEqual(DEFAULT_TIMEOUTS);
    expect(section.features).toEqual(DEFAULT_FEATURES);
    expect(section.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it("includes the editableAt hint pointing to the Owner Panel", () => {
    const section = buildOwnerSettingsElaineSection(ELAINE_CONFIG_DEFAULTS);
    expect(section.editableAt).toMatch(/Owner Panel/i);
  });
});

// ---------------------------------------------------------------------------
// App-config section
// ---------------------------------------------------------------------------

describe("buildOwnerSettingsAppConfigSection", () => {
  /**
   * Synthetic rows shaped like `app_config` table rows: value and type are
   * included to satisfy the function signature, but only module/key/label are
   * asserted in the coverage test.
   */
  function makeRows(defaults: typeof APP_CONFIG_DEFAULTS): Array<{
    module: string;
    key: string;
    label: string;
    value: string;
    type: string;
    description: string | null;
  }> {
    return defaults.map((d) => ({
      module: d.module,
      key: d.key,
      label: d.label,
      value: d.value,
      type: d.type,
      description: d.description ?? null,
    }));
  }

  it("returns an entry for every APP_CONFIG_DEFAULTS module/key pair", () => {
    const rows = makeRows(APP_CONFIG_DEFAULTS);
    const section = buildOwnerSettingsAppConfigSection(rows);

    for (const def of APP_CONFIG_DEFAULTS) {
      const match = section.entries.find(
        (e) => e.module === def.module && e.key === def.key,
      );
      expect(
        match,
        `Expected an entry for ${def.module}/${def.key} in the app-config section. ` +
          `If this is a new APP_CONFIG_DEFAULTS entry, ensure getAllConfig() returns it ` +
          `and that buildOwnerSettingsAppConfigSection is not filtering it out.`,
      ).toBeDefined();
    }
  });

  it("total matches the number of entries", () => {
    const rows = makeRows(APP_CONFIG_DEFAULTS);
    const section = buildOwnerSettingsAppConfigSection(rows);
    expect(section.total).toBe(APP_CONFIG_DEFAULTS.length);
    expect(section.entries).toHaveLength(APP_CONFIG_DEFAULTS.length);
  });

  it("maps description null to undefined in the entry", () => {
    const rows = [
      {
        module: "test",
        key: "no_desc",
        label: "Test",
        value: "1",
        type: "integer",
        description: null,
      },
    ];
    const section = buildOwnerSettingsAppConfigSection(rows);
    expect(section.entries[0]!.description).toBeUndefined();
  });

  it("preserves non-null description in the entry", () => {
    const rows = [
      {
        module: "test",
        key: "with_desc",
        label: "Test",
        value: "1",
        type: "integer",
        description: "A useful description",
      },
    ];
    const section = buildOwnerSettingsAppConfigSection(rows);
    expect(section.entries[0]!.description).toBe("A useful description");
  });

  it("includes the editableAt hint pointing to the Control Panel", () => {
    const section = buildOwnerSettingsAppConfigSection([]);
    expect(section.editableAt).toMatch(/Control Panel/i);
  });

  it("handles an empty row list without throwing", () => {
    const section = buildOwnerSettingsAppConfigSection([]);
    expect(section.entries).toHaveLength(0);
    expect(section.total).toBe(0);
  });
});
