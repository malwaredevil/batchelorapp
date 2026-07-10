import { Building2, Settings } from "lucide-react";
import { registerFeature } from "./registry";

// Pottery's, quilting's, ornaments', and travels' own nav entries are
// registered by @/pottery/features, @/quilting/features, @/ornaments/features,
// and @/travels/features once those modules are imported (see App.tsx) — no
// placeholder needed here since all four have been migrated (see #137, #138,
// #140, #139).

// Reserved for a future "Office" module (Phase 3). No page exists yet, so no
// nav entry is registered until that migration lands.
void Building2;

// Single shared "Settings" nav entry pointing at the hub's unified /account
// page. Pottery, ornaments, quilting, and travels no longer have their own
// settings pages (see #150) — they all resolve to the same account page, so
// this one shared entry replaces what used to be 4 near-duplicate per-app
// links that would otherwise all render side by side in this module's flat
// nav bar.
registerFeature({
  id: "unified-settings",
  nav: {
    group: "settings",
    href: "/account",
    label: "Settings",
    icon: Settings,
    order: 90,
    external: true,
  },
});
