import { registerFeature } from "@/features/registry";
import { Briefcase } from "lucide-react";

// Office is a new, general-purpose sub-app (Gmail inbox + all connected
// calendars + notes). It is intentionally NOT trip-specific and is fully
// independent of Travels' existing Gmail-scan-for-documents and
// shared-Travel-calendar features — see threat_model.md's Gmail/Calendar
// trust boundaries. This issue only reserves the nav slot; real
// Gmail/calendar/notes functionality is built in follow-up issues.

registerFeature({
  id: "office-home",
  nav: {
    group: "main",
    href: "/office",
    label: "Office",
    icon: Briefcase,
    order: 60,
  },
});
