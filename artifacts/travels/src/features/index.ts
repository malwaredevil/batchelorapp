import { registerFeature } from "./registry";
import {
  Home,
  Globe,
  Plane,
  Compass,
  Star,
  MapPin,
  Settings,
  CalendarDays,
  Mail,
  Sparkles,
} from "lucide-react";

// ── Primary ─────────────────────────────────────────────────────────────────

registerFeature({
  id: "home",
  nav: {
    group: "primary",
    href: "/",
    label: "Home",
    icon: Home,
    order: 10,
    mobilePrimary: true,
  },
});

registerFeature({
  id: "trips",
  nav: {
    group: "primary",
    href: "/trips",
    label: "Trips",
    icon: Plane,
    order: 20,
    mobilePrimary: true,
  },
});

// ── Discover ────────────────────────────────────────────────────────────────

registerFeature({
  id: "destinations",
  nav: {
    group: "discover",
    href: "/destinations",
    label: "Places",
    icon: MapPin,
    order: 10,
  },
});

registerFeature({
  id: "map",
  nav: {
    group: "discover",
    href: "/map",
    label: "Map",
    icon: Globe,
    order: 20,
  },
});

registerFeature({
  id: "explore",
  nav: {
    group: "discover",
    href: "/explore",
    label: "Explore",
    icon: Compass,
    order: 30,
  },
});

registerFeature({
  id: "wishlist",
  nav: {
    group: "discover",
    href: "/wishlist",
    label: "Wishlist",
    icon: Star,
    order: 40,
  },
});

// ── Plan ────────────────────────────────────────────────────────────────────

registerFeature({
  id: "travel-calendar",
  nav: {
    group: "plan",
    href: "/travel-calendar",
    label: "Travel Calendar",
    icon: CalendarDays,
    order: 10,
    mobilePrimary: true,
  },
});

registerFeature({
  id: "gmail",
  nav: {
    group: "plan",
    href: "/gmail",
    label: "Gmail",
    icon: Mail,
    order: 20,
    mobilePrimary: true,
  },
});

// ── Account ─────────────────────────────────────────────────────────────────

registerFeature({
  id: "google-apis",
  nav: {
    group: "account",
    href: "/google-apis",
    label: "Google APIs",
    icon: Sparkles,
    order: 10,
  },
});

registerFeature({
  id: "settings",
  nav: {
    group: "account",
    href: "/settings",
    label: "Settings",
    icon: Settings,
    order: 20,
  },
});
