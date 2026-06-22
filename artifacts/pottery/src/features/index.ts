import { registerFeature } from "./registry";
import {
  LayoutGrid,
  PlusCircle,
  ScanSearch,
  Tag,
  Wrench,
  KeyRound,
} from "lucide-react";

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
    order: 20,
  },
});

registerFeature({
  id: "account",
  nav: {
    group: "settings",
    href: "/account",
    label: "Account",
    icon: KeyRound,
    order: 30,
  },
});
