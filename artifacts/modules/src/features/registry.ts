import type { ComponentType } from "react";
import { createFeatureRegistry } from "@workspace/web-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NavGroup = string;

export interface NavEntry {
  group: NavGroup;
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Lower numbers render first within the group. Default: 50. */
  order?: number;
  /**
   * True when `href` points outside this module's SPA (e.g. the hub's
   * `/account` unified settings page). External entries must do a full
   * browser navigation instead of client-side routing — see the
   * `elaine-cross-app-navigation` convention.
   */
  external?: boolean;
}

export interface FeatureRegistration {
  id: string;
  nav?: NavEntry;
}

/** A resolved nav entry, tagged with its owning feature id. Multiple entries
 * can share an `href` (e.g. several external `/account` links), so `id` —
 * not `href` — is the stable React key. */
export interface ResolvedNavEntry extends NavEntry {
  id: string;
}

// ---------------------------------------------------------------------------
// Registry store (module-level singleton — safe for SPA lifecycle)
// ---------------------------------------------------------------------------

const registry = createFeatureRegistry<FeatureRegistration>();

export function registerFeature(config: FeatureRegistration): void {
  registry.register(config);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getNavItems(): ResolvedNavEntry[] {
  return registry
    .list()
    .flatMap((f) => (f.nav ? [{ ...f.nav, id: f.id }] : []))
    .sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
}

export function getNavItemsByGroup(): Record<string, ResolvedNavEntry[]> {
  const items = getNavItems();
  const result: Record<string, ResolvedNavEntry[]> = {};
  for (const item of items) {
    (result[item.group] ??= []).push(item);
  }
  return result;
}
