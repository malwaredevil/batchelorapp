import { registerFeature } from "@/features/registry";
import {
  Library,
  PlusCircle,
  Tags,
  BarChart3,
  Wrench,
  CalendarHeart,
} from "lucide-react";

registerFeature({
  id: "ornaments-collection",
  nav: {
    group: "collection",
    href: "/ornaments",
    label: "Ornaments",
    icon: Library,
    order: 30,
  },
});

registerFeature({
  id: "ornaments-add",
  nav: {
    group: "add",
    href: "/ornaments/add",
    label: "Add Ornament",
    icon: PlusCircle,
    order: 31,
  },
});

registerFeature({
  id: "ornaments-categories",
  nav: {
    group: "settings",
    href: "/ornaments/categories",
    label: "Categories",
    icon: Tags,
    order: 32,
  },
});

registerFeature({
  id: "ornaments-stats",
  nav: {
    group: "settings",
    href: "/ornaments/stats",
    label: "Statistics",
    icon: BarChart3,
    order: 33,
  },
});

registerFeature({
  id: "ornaments-maintenance",
  nav: {
    group: "settings",
    href: "/ornaments/maintenance",
    label: "Maintenance",
    icon: Wrench,
    order: 34,
  },
});

// Hallmark Events tracking was added after the original production nav
// screenshot was taken (see hallmark event tracker feature) — it's an
// intentional new addition, not a migration artifact, so it gets its own
// flat nav button rather than being folded into an existing group.
registerFeature({
  id: "ornaments-hallmark-events",
  nav: {
    group: "hallmark-events",
    href: "/ornaments/hallmark-events",
    label: "Hallmark Events",
    icon: CalendarHeart,
    order: 35,
  },
});
