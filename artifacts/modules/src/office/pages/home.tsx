import { Briefcase } from "lucide-react";

// Shell for Office — a general-purpose sub-app (Gmail inbox, all connected
// calendars, notes). This is intentionally independent from Travels'
// trip-specific Gmail-scan-for-documents and shared-Travel-calendar features
// (see threat_model.md); Office must never read from or write to those
// Travels-only surfaces. Navigation between sections is handled by the
// persistent OfficeLayout toolbar, not by buttons on this page.
export default function OfficeHome() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <Briefcase className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-2xl font-bold text-foreground">Office</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        General household Gmail inbox, all connected calendars, and notes. Use
        the tabs above to jump in.
      </p>
    </div>
  );
}
