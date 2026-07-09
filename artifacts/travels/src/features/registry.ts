import type { ComponentType } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityType = "trip";
export type NavGroup = "primary" | "discover" | "plan" | "account";

export interface NavEntry {
  group: NavGroup;
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Lower numbers render first within the group. Default: 50. */
  order?: number;
  /** Show this item in the curated mobile bottom-nav row (vs. the "More" sheet). */
  mobilePrimary?: boolean;
}

export interface ContextAction {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick: (entityId: number) => void;
}

export interface FeatureRegistration {
  id: string;
  nav?: NavEntry;
  /** Actions injected into right-click / 3-dot menus for specific entity types. */
  contextActions?: Partial<Record<EntityType, ContextAction[]>>;
}

// ---------------------------------------------------------------------------
// Registry store (module-level singleton — safe for SPA lifecycle)
// ---------------------------------------------------------------------------

const _features: FeatureRegistration[] = [];

export function registerFeature(config: FeatureRegistration): void {
  if (_features.some((f) => f.id === config.id)) return; // idempotent
  _features.push(config);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getNavItems(): NavEntry[] {
  return _features
    .flatMap((f) => (f.nav ? [f.nav] : []))
    .sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
}

export function getNavItemsByGroup(): Record<NavGroup, NavEntry[]> {
  const items = getNavItems();
  const result: Record<NavGroup, NavEntry[]> = {
    primary: [],
    discover: [],
    plan: [],
    account: [],
  };
  for (const item of items) {
    result[item.group].push(item);
  }
  return result;
}

export function getMobilePrimaryItems(): NavEntry[] {
  return getNavItems().filter((item) => item.mobilePrimary);
}

export function getMobileMoreItems(): NavEntry[] {
  return getNavItems().filter((item) => !item.mobilePrimary);
}

export function getContextActions(entityType: EntityType): ContextAction[] {
  return _features.flatMap((f) => f.contextActions?.[entityType] ?? []);
}
