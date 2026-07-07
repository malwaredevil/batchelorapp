import { type ReactNode, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useGuardedNavigate } from "@/lib/nav-guard";
import {
  LogOut,
  Library,
  ShoppingBag,
  PenTool,
  Settings2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { AppSwitcher } from "@workspace/elaine-ui";
import { InstallBanner } from "@workspace/web-core";
import {
  useLogout,
  getGetCurrentUserQueryKey,
  useGetStaleCount,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getNavItemsByGroup, type NavGroup } from "@/features/registry";

// ---------------------------------------------------------------------------
// Group metadata — label + icon shown in header and mobile tab bar
// ---------------------------------------------------------------------------

const GROUP_ORDER: NavGroup[] = [
  "collection",
  "shopping",
  "design",
  "settings",
];

const GROUP_META: Record<
  NavGroup,
  { label: string; Icon: React.FC<{ className?: string }> }
> = {
  collection: { label: "Collection", Icon: Library },
  shopping: { label: "Shopping", Icon: ShoppingBag },
  design: { label: "Design", Icon: PenTool },
  settings: { label: "Settings", Icon: Settings2 },
};

// ---------------------------------------------------------------------------

function isActive(current: string, href: string) {
  if (href === "/") return current === "/";
  return current === href || current.startsWith(href + "/");
}

/** The nav item whose badge surfaces the stale-items count. */
const STALE_BADGE_HREF = "/maintenance";

/** Small pill showing a count; renders nothing when the count is 0. */
function CountBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none text-white",
        className,
      )}
      title={`${count} item${count === 1 ? "" : "s"} need re-analysis`}
      aria-label={`${count} item${count === 1 ? "" : "s"} need re-analysis`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [location, rawNavigate] = useLocation();
  const navigate = useGuardedNavigate(rawNavigate);
  const queryClient = useQueryClient();
  const groups = getNavItemsByGroup();

  // Fabrics/patterns missing their AI embedding (e.g. after a DB restore) need
  // re-analysing. Surface the total as a badge on the Settings/Maintenance nav
  // so the owner notices without opening the Maintenance page first. A dedicated
  // count endpoint keeps this cheap — no full list payloads just for a number.
  const { data: stale } = useGetStaleCount();
  const staleCount = stale?.count ?? 0;
  const staleByGroup: Partial<Record<NavGroup, number>> = {
    settings: staleCount,
  };

  // Which mobile group sheet is open (null = none)
  const [openGroup, setOpenGroup] = useState<NavGroup | null>(null);

  // Close the sheet whenever the route changes
  useEffect(() => {
    setOpenGroup(null);
  }, [location]);

  const logout = useLogout({
    mutation: {
      onMutate: async () => {
        await queryClient.cancelQueries();
      },
      onSuccess: () => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), null);
        window.location.href = "/login";
      },
      onError: () => toast.error("Could not sign out. Please try again."),
    },
  });

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-card-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          {/* App switcher */}
          <AppSwitcher currentAppId="quilting" />

          {/* Desktop nav */}
          <div className="flex items-center gap-1">
            <nav className="mr-1 hidden items-center gap-0.5 md:flex">
              {GROUP_ORDER.map((group) => {
                const items = groups[group];
                if (!items || items.length === 0) return null;

                const groupActive = items.some((item) =>
                  isActive(location, item.href),
                );
                const { label, Icon } = GROUP_META[group];
                const groupStale = staleByGroup[group] ?? 0;

                const triggerCls = cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none",
                  groupActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                );

                // Single-item group → plain button (guarded navigation)
                if (items.length === 1) {
                  return (
                    <button
                      key={group}
                      onClick={() => navigate(items[0].href)}
                      className={triggerCls}
                      data-testid={`navgroup-${group}`}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                      {groupStale > 0 && (
                        <CountBadge count={groupStale} className="ml-0.5" />
                      )}
                    </button>
                  );
                }

                // Multi-item group → dropdown
                return (
                  <DropdownMenu key={group}>
                    <DropdownMenuTrigger asChild>
                      <button
                        className={triggerCls}
                        data-testid={`navgroup-${group}`}
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                        {groupStale > 0 && (
                          <CountBadge count={groupStale} className="ml-0.5" />
                        )}
                        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                      {items.map((item) => {
                        const active = isActive(location, item.href);
                        const itemStale =
                          item.href === STALE_BADGE_HREF ? staleCount : 0;
                        return (
                          <DropdownMenuItem
                            key={item.href}
                            onSelect={() => navigate(item.href)}
                            className={cn(
                              active && "text-primary focus:text-primary",
                            )}
                            data-testid={`navlink-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                          >
                            <item.icon
                              className={cn(
                                "mr-2 h-4 w-4 shrink-0",
                                active
                                  ? "text-primary"
                                  : "text-muted-foreground",
                              )}
                            />
                            {item.label}
                            {itemStale > 0 && (
                              <CountBadge
                                count={itemStale}
                                className="ml-auto"
                              />
                            )}
                            {active && (
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full bg-primary",
                                  itemStale > 0 ? "ml-1.5" : "ml-auto",
                                )}
                              />
                            )}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })}
            </nav>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              title="Sign out"
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <InstallBanner />

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 md:pb-12">
        {children}
      </main>

      {/* ── Mobile bottom tab bar — one tab per group ───────────────────────── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-card-border bg-background/95 backdrop-blur md:hidden">
        {/* ── Group expansion sheet (slides up from tab bar) ── */}
        {openGroup &&
          (() => {
            const items = groups[openGroup];
            if (!items) return null;
            return (
              <>
                {/* Tap-outside backdrop */}
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setOpenGroup(null)}
                  aria-hidden
                />
                {/* Item list panel */}
                <div className="absolute inset-x-0 bottom-full z-40 border-t border-card-border bg-background/97 shadow-[0_-4px_24px_rgba(0,0,0,0.10)] backdrop-blur">
                  <div className="mx-auto max-w-md divide-y divide-border/60">
                    {items.map((item) => {
                      const active = isActive(location, item.href);
                      const itemStale =
                        item.href === STALE_BADGE_HREF ? staleCount : 0;
                      return (
                        <button
                          key={item.href}
                          onClick={() => {
                            navigate(item.href);
                            setOpenGroup(null);
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 px-5 py-4 text-sm font-medium transition-colors active:bg-muted",
                            active ? "text-primary" : "text-foreground",
                          )}
                          data-testid={`sheet-navlink-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          <item.icon
                            className={cn(
                              "h-4 w-4 shrink-0",
                              active ? "text-primary" : "text-muted-foreground",
                            )}
                          />
                          {item.label}
                          {itemStale > 0 && (
                            <CountBadge count={itemStale} className="ml-auto" />
                          )}
                          {active && (
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full bg-primary",
                                itemStale > 0 ? "ml-1.5" : "ml-auto",
                              )}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            );
          })()}

        {/* ── Tab items ── */}
        <div className="mx-auto flex max-w-md items-stretch justify-around px-2 py-1.5">
          {GROUP_ORDER.map((group) => {
            const items = groups[group];
            if (!items || items.length === 0) return null;

            const groupActive = items.some((item) =>
              isActive(location, item.href),
            );
            const isOpen = openGroup === group;
            const { label, Icon } = GROUP_META[group];
            const isMulti = items.length > 1;
            const groupStale = staleByGroup[group] ?? 0;

            const tabCls = cn(
              "flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors",
              groupActive || isOpen ? "text-primary" : "text-muted-foreground",
            );

            if (!isMulti) {
              // Single item — guarded navigation
              return (
                <button
                  key={group}
                  onClick={() => navigate(items[0].href)}
                  className={tabCls}
                  data-testid={`tab-${group}`}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5",
                      (groupActive || isOpen) &&
                        "scale-110 transition-transform",
                    )}
                  />
                  {label}
                </button>
              );
            }

            // Multi-item group — tap opens/closes the expansion sheet
            return (
              <button
                key={group}
                onClick={() => setOpenGroup(isOpen ? null : group)}
                className={tabCls}
                data-testid={`tab-${group}`}
                aria-expanded={isOpen}
              >
                <span className="relative">
                  <Icon
                    className={cn(
                      "h-5 w-5",
                      (groupActive || isOpen) &&
                        "scale-110 transition-transform",
                    )}
                  />
                  {isOpen && (
                    <ChevronUp className="absolute -right-2.5 -top-2.5 h-3 w-3 text-primary" />
                  )}
                  {!isOpen && groupStale > 0 && (
                    <CountBadge
                      count={groupStale}
                      className="absolute -right-2.5 -top-2 h-4 min-w-[16px] px-1 text-[9px]"
                    />
                  )}
                </span>
                {label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
