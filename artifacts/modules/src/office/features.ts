import { registerFeature } from "@/features/registry";
import { Mail, CalendarDays, NotebookPen, MessageSquare } from "lucide-react";

registerFeature({
  id: "office-inbox",
  nav: {
    group: "inbox",
    href: "/office/gmail",
    label: "Inbox",
    icon: Mail,
    order: 60,
  },
});

registerFeature({
  id: "office-calendar",
  nav: {
    group: "calendar",
    href: "/office/calendar",
    label: "Calendar",
    icon: CalendarDays,
    order: 61,
  },
});

registerFeature({
  id: "office-notes",
  nav: {
    group: "notes",
    href: "/office/notes",
    label: "Notes",
    icon: NotebookPen,
    order: 62,
  },
});

registerFeature({
  id: "office-messenger",
  nav: {
    group: "messenger",
    href: "/office/messenger",
    label: "Messenger",
    icon: MessageSquare,
    order: 63,
  },
});
