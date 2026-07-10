import { registerFeature } from "@/features/registry";
import {
  Home,
  Globe,
  Plane,
  Compass,
  Star,
  MapPin,
  CalendarDays,
  Mail,
  FileText,
} from "lucide-react";

// Mirrors artifacts/travels/src/features/index.ts, namespaced under
// /travels/* to match this module's route mount point. Travels previously
// grouped these into primary/discover/plan/account sub-menus rendered by
// its own Layout header; the modules ModuleShell uses a flat main/settings
// split instead, so all travels nav entries are registered directly here.

registerFeature({
  id: "travels-home",
  nav: {
    group: "home",
    href: "/travels",
    label: "Home",
    icon: Home,
    order: 40,
  },
});

registerFeature({
  id: "travels-trips",
  nav: {
    group: "trips",
    href: "/travels/trips",
    label: "Trips",
    icon: Plane,
    order: 41,
  },
});

registerFeature({
  id: "travels-destinations",
  nav: {
    group: "discover",
    href: "/travels/destinations",
    label: "Places",
    icon: MapPin,
    order: 42,
  },
});

registerFeature({
  id: "travels-map",
  nav: {
    group: "discover",
    href: "/travels/map",
    label: "Map",
    icon: Globe,
    order: 43,
  },
});

registerFeature({
  id: "travels-explore",
  nav: {
    group: "discover",
    href: "/travels/explore",
    label: "Explore",
    icon: Compass,
    order: 44,
  },
});

registerFeature({
  id: "travels-wishlist",
  nav: {
    group: "discover",
    href: "/travels/wishlist",
    label: "Wishlist",
    icon: Star,
    order: 45,
  },
});

registerFeature({
  id: "travels-travel-calendar",
  nav: {
    group: "plan",
    href: "/travels/travel-calendar",
    label: "Travel Calendar",
    icon: CalendarDays,
    order: 46,
  },
});

registerFeature({
  id: "travels-gmail",
  nav: {
    group: "plan",
    href: "/travels/gmail",
    label: "Gmail",
    icon: Mail,
    order: 47,
  },
});

registerFeature({
  id: "travels-documents",
  nav: {
    group: "plan",
    href: "/travels/documents",
    label: "Documents",
    icon: FileText,
    order: 48,
  },
});

// Google APIs demo page is no longer linked from the travels nav — it now
// lives only on the hub Account page for owner accounts (see
// artifacts/web/src/pages/account.tsx).
