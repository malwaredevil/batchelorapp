import { type ReactNode } from "react";

// Office sub-pages (Inbox, Calendar, Notes) are navigated via the top-level
// module nav bar (same position as Pottery/Quilting/Travels), so no secondary
// nav is rendered here. This wrapper is kept as a thin pass-through so App.tsx
// route definitions don't need to change.
export function OfficeLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
