/**
 * Pure serialization helpers for the `get_owner_settings` tool.
 *
 * Extracted from the inline dispatch branch so they can be unit-tested in
 * isolation: the test suite asserts that every key of `ELAINE_CONFIG_DEFAULTS`
 * and every `APP_CONFIG_DEFAULTS` module/key pair actually appears in the
 * report, catching drift when a new configurable value is added to either
 * source without being added to the serializer.
 */

import type { ElaineGlobalConfig } from "../lib/elaine-config";
import type { AppConfigDefault } from "../lib/app-config";

// ── Elaine global-config section ─────────────────────────────────────────────

export interface OwnerSettingsElaineSection {
  chatModel: string;
  subagentModel: string;
  requestTimeoutMs: number;
  maxResponseTokens: number;
  models: ElaineGlobalConfig["models"];
  timeouts: ElaineGlobalConfig["timeouts"];
  runtimeBudget: ElaineGlobalConfig["runtimeBudget"];
  features: ElaineGlobalConfig["features"];
  thresholds: ElaineGlobalConfig["thresholds"];
  /** ISO string or null — renamed from `updatedAt` for readability in the chat output. */
  lastUpdatedAt: string | null;
  editableAt: string;
}

/**
 * Serialize a `ElaineGlobalConfig` value into the shape sent back to the
 * model.  Every key of `ELAINE_CONFIG_DEFAULTS` must have a corresponding
 * output key here (with `updatedAt` renamed to `lastUpdatedAt`); the unit
 * tests in `owner-settings-report.test.ts` enforce this automatically.
 */
export function buildOwnerSettingsElaineSection(
  cfg: ElaineGlobalConfig,
): OwnerSettingsElaineSection {
  return {
    chatModel: cfg.chatModel,
    subagentModel: cfg.subagentModel,
    requestTimeoutMs: cfg.requestTimeoutMs,
    maxResponseTokens: cfg.maxResponseTokens,
    models: cfg.models,
    timeouts: cfg.timeouts,
    runtimeBudget: cfg.runtimeBudget,
    features: cfg.features,
    thresholds: cfg.thresholds,
    lastUpdatedAt: cfg.updatedAt, // updatedAt in ElaineGlobalConfig
    editableAt: "Owner Panel → Global Configuration",
  };
}

// ── App-config section ────────────────────────────────────────────────────────

export interface OwnerSettingsAppConfigEntry {
  module: string;
  key: string;
  label: string;
  value: string;
  /** Raw TEXT value from the DB — callers interpret it as the appropriate union. */
  type: string;
  description?: string;
}

export interface OwnerSettingsAppConfigSection {
  entries: OwnerSettingsAppConfigEntry[];
  total: number;
  editableAt: string;
}

/**
 * Serialize a list of `app_config` rows (as returned by `getAllConfig()`) into
 * the shape sent back to the model.
 */
export function buildOwnerSettingsAppConfigSection(
  rows: Array<{
    module: string;
    key: string;
    label: string;
    value: string;
    /** The `app_config` table stores this as TEXT; the union is a code-layer
     *  contract.  Accept `string` here so the function accepts raw DB rows
     *  without an intermediate narrowing cast at every call site. */
    type: string;
    description: string | null;
  }>,
): OwnerSettingsAppConfigSection {
  return {
    entries: rows.map((r) => ({
      module: r.module,
      key: r.key,
      label: r.label,
      value: r.value,
      type: r.type,
      description: r.description ?? undefined,
    })),
    total: rows.length,
    editableAt: "Owner Panel → Control Panel",
  };
}
