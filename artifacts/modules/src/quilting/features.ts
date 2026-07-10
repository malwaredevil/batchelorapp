import { registerFeature } from "@/features/registry";
import {
  Scissors,
  BookOpen,
  Layers,
  ScanSearch,
  Tag,
  Grid2X2,
  LayoutGrid,
  ShoppingCart,
  Wrench,
  Ruler,
  LibraryBig,
} from "lucide-react";

// Mirrors artifacts/quilting/src/features/index.ts, namespaced under
// /quilting/* to match this module's route mount point.

// This module's shared nav registry only has "main" and "settings" groups
// (see @/features/registry.ts) — unlike standalone quilting's local
// collection/shopping/design groups, everything here collapses into "main",
// mirroring the pottery migration's approach (see @/pottery/features.ts).

registerFeature({
  id: "quilting-fabrics",
  nav: {
    group: "collection",
    href: "/quilting/fabrics",
    label: "Fabrics",
    icon: Scissors,
    order: 20,
  },
});

registerFeature({
  id: "quilting-patterns",
  nav: {
    group: "collection",
    href: "/quilting/patterns",
    label: "Patterns",
    icon: BookOpen,
    order: 21,
  },
});

registerFeature({
  id: "quilting-quilts",
  nav: {
    group: "collection",
    href: "/quilting/quilts",
    label: "Finished Quilts",
    icon: Layers,
    order: 22,
  },
});

registerFeature({
  id: "quilting-block-library",
  nav: {
    group: "collection",
    href: "/quilting/library/blocks",
    label: "Block Patterns",
    icon: LibraryBig,
    order: 23,
  },
});

registerFeature({
  id: "quilting-compare",
  nav: {
    group: "shopping",
    href: "/quilting/compare",
    label: "Do I own this?",
    icon: ScanSearch,
    order: 24,
  },
});

registerFeature({
  id: "quilting-shopping",
  nav: {
    group: "shopping",
    href: "/quilting/shopping",
    label: "Shopping List",
    icon: ShoppingCart,
    order: 25,
  },
});

registerFeature({
  id: "quilting-blocks",
  nav: {
    group: "design",
    href: "/quilting/blocks",
    label: "Block Designer",
    icon: Grid2X2,
    order: 26,
  },
});

registerFeature({
  id: "quilting-layouts",
  nav: {
    group: "design",
    href: "/quilting/layouts",
    label: "Layout Composer",
    icon: LayoutGrid,
    order: 27,
  },
});

registerFeature({
  id: "quilting-yardage",
  nav: {
    group: "design",
    href: "/quilting/tools/yardage",
    label: "Yardage Calculator",
    icon: Ruler,
    order: 28,
  },
});

// Whole-Quilt Designer is hidden from nav for now — routes still exist in
// App.tsx (mirrors upstream artifacts/quilting behavior).

registerFeature({
  id: "quilting-categories",
  nav: {
    group: "settings",
    href: "/quilting/categories",
    label: "Categories",
    icon: Tag,
    order: 29,
  },
});

registerFeature({
  id: "quilting-maintenance",
  nav: {
    group: "settings",
    href: "/quilting/maintenance",
    label: "Maintenance",
    icon: Wrench,
    order: 30,
  },
});
