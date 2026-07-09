import { registerFeature } from "./registry";
import { MessageSquare, Settings as SettingsIcon } from "lucide-react";

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
  id: "settings",
  nav: {
    group: "main",
    href: "/settings",
    label: "Settings",
    icon: SettingsIcon,
    order: 20,
    testId: "navlink-settings",
  },
});
