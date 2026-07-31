import type { ComponentType } from "react";
import { createFeatureRegistry } from "@workspace/web-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityType = never;
export type NavGroup = "main";

export interface NavEntry {
  group: NavGroup;
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Lower numbers render first within the group. Default: 50. */
  order?: number;
  testId?: string;
  /** True if href crosses an artifact boundary and needs a full browser nav. */
  external?: boolean;
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

const registry = createFeatureRegistry<FeatureRegistration>();

export function registerFeature(config: FeatureRegistration): void {
  registry.register(config);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getNavItems(): NavEntry[] {
  return registry
    .list()
    .flatMap((f) => (f.nav ? [f.nav] : []))
    .sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
}

export function getNavItemsByGroup(): Record<NavGroup, NavEntry[]> {
  const items = getNavItems();
  const result: Record<NavGroup, NavEntry[]> = {
    main: [],
  };
  for (const item of items) {
    result[item.group].push(item);
  }
  return result;
}
