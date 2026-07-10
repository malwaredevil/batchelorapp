import { registerFeature } from "./registry";
import { Library, PlusCircle, Tags, BarChart3, Wrench } from "lucide-react";

registerFeature({
  id: "collection",
  nav: {
    group: "main",
    href: "/",
    label: "Collection",
    icon: Library,
    order: 10,
  },
});

registerFeature({
  id: "add",
  nav: {
    group: "main",
    href: "/add",
    label: "Add Ornament",
    icon: PlusCircle,
    order: 20,
  },
});

// Note: "scan" (barcode scanning) is intentionally not registered as a nav
// item anymore — the /scan route and ScanPage component still exist and are
// reused via a small barcode icon button on the Add Ornament page instead.

// Settings nav items
registerFeature({
  id: "categories",
  nav: {
    group: "settings",
    href: "/categories",
    label: "Categories",
    icon: Tags,
    order: 10,
  },
});

registerFeature({
  id: "stats",
  nav: {
    group: "settings",
    href: "/stats",
    label: "Statistics",
    icon: BarChart3,
    order: 20,
  },
});

registerFeature({
  id: "maintenance",
  nav: {
    group: "settings",
    href: "/maintenance",
    label: "Maintenance",
    icon: Wrench,
    order: 30,
  },
});
