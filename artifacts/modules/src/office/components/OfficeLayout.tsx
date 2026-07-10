import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { CalendarDays, Home, Mail, NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";

// Persistent in-app toolbar for Office (Home / Gmail / Calendar / Notes),
// distinct from the top-level module nav — Office is one module with four
// internal sections, not four separate modules.
const TABS = [
  { href: "/office", label: "Home", icon: Home, exact: true },
  { href: "/office/gmail", label: "Gmail", icon: Mail },
  { href: "/office/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/office/notes", label: "Notes", icon: NotebookPen },
] as const;

export function OfficeLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex min-h-screen flex-col">
      <nav className="flex items-center gap-1 border-b border-border bg-background/80 px-3 py-2 backdrop-blur-md">
        {TABS.map((tab) => {
          const active =
            "exact" in tab && tab.exact
              ? location === tab.href
              : location.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex-1">{children}</div>
    </div>
  );
}
