import { registerFeature } from "./registry";
import { MessageSquare, Settings as SettingsIcon, Brain } from "lucide-react";

registerFeature({
  id: "chat",
  nav: {
    group: "main",
    href: "/",
    label: "Chat",
    icon: MessageSquare,
    order: 10,
    testId: "navlink-chat",
  },
});

registerFeature({
  id: "memory",
  nav: {
    group: "main",
    href: "/memory",
    label: "Memory",
    icon: Brain,
    order: 15,
    testId: "navlink-memory",
  },
});

registerFeature({
  id: "settings",
  nav: {
    group: "main",
    href: "/account",
    label: "Settings",
    icon: SettingsIcon,
    order: 20,
    testId: "navlink-settings",
    external: true,
  },
});
