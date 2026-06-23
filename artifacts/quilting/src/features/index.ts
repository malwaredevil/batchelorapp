import { registerFeature } from "./registry";
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
} from "lucide-react";

// ── Collection ────────────────────────────────────────────────────────────────

registerFeature({
  id: "fabrics",
  nav: {
    group: "collection",
    href: "/fabrics",
    label: "Fabrics",
    icon: Scissors,
    order: 10,
  },
});

registerFeature({
  id: "patterns",
  nav: {
    group: "collection",
    href: "/patterns",
    label: "Patterns",
    icon: BookOpen,
    order: 20,
  },
});

registerFeature({
  id: "quilts",
  nav: {
    group: "collection",
    href: "/quilts",
    label: "Finished Quilts",
    icon: Layers,
    order: 30,
  },
});

// ── Shopping ──────────────────────────────────────────────────────────────────

registerFeature({
  id: "compare",
  nav: {
    group: "shopping",
    href: "/compare",
    label: "Do I own this?",
    icon: ScanSearch,
    order: 10,
  },
});

registerFeature({
  id: "shopping",
  nav: {
    group: "shopping",
    href: "/shopping",
    label: "Shopping List",
    icon: ShoppingCart,
    order: 20,
  },
});

// ── Design ────────────────────────────────────────────────────────────────────

registerFeature({
  id: "blocks",
  nav: {
    group: "design",
    href: "/blocks",
    label: "Block Designer",
    icon: Grid2X2,
    order: 10,
  },
});

registerFeature({
  id: "layouts",
  nav: {
    group: "design",
    href: "/layouts",
    label: "Layout Composer",
    icon: LayoutGrid,
    order: 20,
  },
});

// Whole-Quilt Designer is hidden from nav for now — routes still exist in App.tsx
// registerFeature({
//   id: "whole-quilt",
//   nav: {
//     group: "design",
//     href: "/whole-quilt",
//     label: "Whole-Quilt Designer",
//     icon: Pencil,
//     order: 30,
//   },
// });

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
  id: "maintenance",
  nav: {
    group: "settings",
    href: "/maintenance",
    label: "Maintenance",
    icon: Wrench,
    order: 15,
  },
});
