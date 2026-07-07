import { registerFeature } from "./registry";
import { LayoutGrid, PlusCircle, ScanSearch, Tag, Wrench, Camera, BarChart3 } from "lucide-react";

// ── Main ────────────────────────────────────────────────────────────────────

registerFeature({
  id: "collection",
  nav: {
    group: "main",
    href: "/",
    label: "Collection",
    icon: LayoutGrid,
    order: 10,
  },
});

registerFeature({
  id: "add",
  nav: {
    group: "main",
    href: "/add",
    label: "Add piece",
    icon: PlusCircle,
    order: 20,
  },
});

registerFeature({
  id: "compare",
  nav: {
    group: "main",
    href: "/compare",
    label: "Compare",
    icon: ScanSearch,
    order: 30,
  },
});

registerFeature({
  id: "scan",
  nav: {
    group: "main",
    href: "/scan",
    label: "Scan",
    icon: Camera,
    order: 35,
  },
});

// ── Settings ──────────────────────────────────────────────────────────────────

registerFeature({
  id: "categories",
  nav: {
    group: "settings",
    href: "/categories",
    label: "Categories",
    icon: Tag,
    order: 10,
  },
});

registerFeature({
  id: "stats",
  nav: {
    group: "settings",
    href: "/stats",
    label: "Collection Stats",
    icon: BarChart3,
    order: 15,
  },
});

registerFeature({
  id: "maintenance",
  nav: {
    group: "settings",
    href: "/maintenance",
    label: "Maintenance",
    icon: Wrench,
    order: 20,
  },
});
