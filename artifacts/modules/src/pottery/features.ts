import { registerFeature } from "@/features/registry";
import {
  LayoutGrid,
  PlusCircle,
  ScanSearch,
  Tag,
  Wrench,
  Camera,
  BarChart3,
  Bell,
} from "lucide-react";

// Mirrors artifacts/pottery/src/features/index.ts, namespaced under
// /pottery/* to match this module's route mount point.

registerFeature({
  id: "pottery-collection",
  nav: {
    group: "collection",
    href: "/pottery",
    label: "Collection",
    icon: LayoutGrid,
    order: 10,
  },
});

registerFeature({
  id: "pottery-add",
  nav: {
    group: "add",
    href: "/pottery/add",
    label: "Add piece",
    icon: PlusCircle,
    order: 11,
  },
});

registerFeature({
  id: "pottery-compare",
  nav: {
    group: "compare",
    href: "/pottery/compare",
    label: "Compare",
    icon: ScanSearch,
    order: 12,
  },
});

registerFeature({
  id: "pottery-scan",
  nav: {
    group: "scan",
    href: "/pottery/scan",
    label: "Scan",
    icon: Camera,
    order: 13,
  },
});

registerFeature({
  id: "pottery-categories",
  nav: {
    group: "settings",
    href: "/pottery/categories",
    label: "Categories",
    icon: Tag,
    order: 14,
  },
});

registerFeature({
  id: "pottery-stats",
  nav: {
    group: "settings",
    href: "/pottery/stats",
    label: "Collection Stats",
    icon: BarChart3,
    order: 15,
  },
});

registerFeature({
  id: "pottery-maintenance",
  nav: {
    group: "settings",
    href: "/pottery/maintenance",
    label: "Maintenance",
    icon: Wrench,
    order: 16,
  },
});

registerFeature({
  id: "pottery-watchlist",
  nav: {
    group: "tools",
    href: "/pottery/watchlist",
    label: "Watchlist",
    icon: Bell,
    order: 17,
  },
});
