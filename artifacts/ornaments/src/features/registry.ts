import type { ComponentType } from "react";

export type EntityType = "ornament";
export type NavGroup = "main" | "settings";

export interface NavEntry {
  group: NavGroup;
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  order?: number;
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
  contextActions?: Partial<Record<EntityType, ContextAction[]>>;
}

const _features: FeatureRegistration[] = [];

export function registerFeature(config: FeatureRegistration): void {
  if (_features.some((f) => f.id === config.id)) return;
  _features.push(config);
}

export function getNavItems(): NavEntry[] {
  return _features
    .flatMap((f) => (f.nav ? [f.nav] : []))
    .sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
}

export function getNavItemsByGroup(): Record<NavGroup, NavEntry[]> {
  const items = getNavItems();
  const result: Record<NavGroup, NavEntry[]> = {
    main: [],
    settings: [],
  };
  for (const item of items) {
    result[item.group].push(item);
  }
  return result;
}

export function getContextActions(entityType: EntityType): ContextAction[] {
  return _features.flatMap((f) => f.contextActions?.[entityType] ?? []);
}
