import { registerFeature } from "./registry";
import { Library, PlusCircle, ScanBarcode, Settings, Tags, BarChart3, Wrench, KeyRound } from "lucide-react";

registerFeature({
  id: "collection",
  nav: { group: "main", href: "/", label: "Collection", icon: Library, order: 10 },
});

registerFeature({
  id: "add",
  nav: { group: "main", href: "/add", label: "Add Manually", icon: PlusCircle, order: 20 },
});

registerFeature({
  id: "scan",
  nav: { group: "main", href: "/scan", label: "Scan Barcode", icon: ScanBarcode, order: 30 },
});

registerFeature({
  id: "settings",
  nav: { group: "main", href: "/settings", label: "Settings", icon: Settings, order: 40 },
});

// Settings nav items
registerFeature({
  id: "categories",
  nav: { group: "settings", href: "/categories", label: "Categories", icon: Tags, order: 10 },
});

registerFeature({
  id: "stats",
  nav: { group: "settings", href: "/stats", label: "Statistics", icon: BarChart3, order: 20 },
});

registerFeature({
  id: "maintenance",
  nav: { group: "settings", href: "/maintenance", label: "Maintenance", icon: Wrench, order: 30 },
});
