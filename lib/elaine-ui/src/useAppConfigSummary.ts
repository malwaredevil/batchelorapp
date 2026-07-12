import { useGetAppConfig } from "@workspace/api-client-react";

/**
 * Builds a compact one-paragraph summary of the current app_config suitable
 * for appending to any page's pageContext string.
 *
 * Returns `undefined` while the config is still loading, on error, or when no
 * config rows are available (so the caller's existing context is unaffected).
 */
export function useAppConfigSummary(): string | undefined {
  const { data, isLoading, isError } = useGetAppConfig();

  if (isLoading || isError || !data?.config?.length) return undefined;

  const rows = data.config;
  const customised = rows.filter(
    (r) => r.defaultValue !== null && r.value !== r.defaultValue,
  );

  const allSummary = rows
    .map((r) => `${r.module}.${r.key}=${r.value}`)
    .join(", ");

  const customisedSummary =
    customised.length > 0
      ? ` Customised settings (changed from default): ${customised.map((r) => `${r.module}.${r.key}=${r.value} (default: ${r.defaultValue}, label: "${r.label}")`).join(", ")}.`
      : " All settings are at their defaults.";

  return (
    `App config snapshot (${rows.length} setting${rows.length !== 1 ? "s" : ""}, ` +
    `${customised.length} customised): ${allSummary}.` +
    customisedSummary +
    " Elaine can propose or apply changes via the update_app_config action — the full Control Panel is at /control-panel (owner-only)."
  );
}
