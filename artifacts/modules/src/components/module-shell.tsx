import { type ReactNode, type ComponentType, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { AppSwitcher, type AppId, useTheme } from "@workspace/elaine-ui";
import { MessengerNavIcon } from "@workspace/messenger-ui";
import { useBackgroundTasks } from "@/lib/background-tasks";
import { InstallBanner } from "@workspace/web-core";
import {
  useLogout,
  useGetCurrentUser,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  LogOut,
  ChevronDown,
  Library,
  ShoppingBag,
  PenTool,
  Settings2,
  Settings,
  Home,
  Compass,
  CalendarDays,
  LayoutGrid,
  Plane,
  PlusCircle,
  ScanSearch,
  Camera,
  CalendarHeart,
  Mail,
  NotebookPen,
  MessageSquare,
  Menu,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getNavItemsByGroup, type ResolvedNavEntry } from "@/features/registry";

function isActive(current: string, href: string) {
  if (href === "/") return current === "/";
  return current === href || current.startsWith(href + "/");
}

/** First path segment, e.g. "/travels/trips/12" -> "travels", "/" -> "". */
function rootSegment(path: string) {
  return path.split("/")[1] ?? "";
}

// Per-module submenu labels/icons, restoring each app's original grouped
// nav structure (pottery: collection/settings, quilting: collection/
// shopping/design/settings, travels: primary/discover/plan, ornaments:
// collection/settings). Unlisted groups fall back to a generic label.
const GROUP_META: Record<
  string,
  Record<string, { label: string; icon: ComponentType<{ className?: string }> }>
> = {
  pottery: {
    collection: { label: "Collection", icon: LayoutGrid },
    add: { label: "Add piece", icon: PlusCircle },
    compare: { label: "Compare", icon: ScanSearch },
    scan: { label: "Scan", icon: Camera },
    settings: { label: "Settings", icon: Settings2 },
  },
  quilting: {
    collection: { label: "Collection", icon: Library },
    shopping: { label: "Shopping", icon: ShoppingBag },
    design: { label: "Design", icon: PenTool },
    settings: { label: "Settings", icon: Settings2 },
  },
  ornaments: {
    collection: { label: "Collection", icon: LayoutGrid },
    add: { label: "Add Ornament", icon: PlusCircle },
    "hallmark-events": { label: "Hallmark Events", icon: CalendarHeart },
    settings: { label: "Settings", icon: Settings2 },
  },
  travels: {
    home: { label: "Home", icon: Home },
    trips: { label: "Trips", icon: Plane },
    discover: { label: "Discover", icon: Compass },
    plan: { label: "Plan", icon: CalendarDays },
    settings: { label: "Settings", icon: Settings2 },
  },
  office: {
    inbox: { label: "Inbox", icon: Mail },
    calendar: { label: "Calendar", icon: CalendarDays },
    notes: { label: "Notes", icon: NotebookPen },
    messenger: { label: "Messenger", icon: MessageSquare },
  },
};

const GROUP_ORDER: Record<string, string[]> = {
  pottery: ["collection", "add", "compare", "scan", "settings"],
  quilting: ["collection", "shopping", "design", "settings"],
  office: ["inbox", "calendar", "notes", "messenger"],
  ornaments: ["collection", "add", "hallmark-events", "settings"],
  travels: ["home", "trips", "discover", "plan", "settings"],
};

// Each module gets its own favicon so the browser tab is visually
// distinguishable when several modules are open at once.
const MODULE_FAVICONS: Record<string, string> = {
  pottery: "/favicons/pottery.svg",
  quilting: "/favicons/quilting.svg",
  ornaments: "/favicons/ornaments.svg",
  travels: "/favicons/travels.svg",
  office: "/favicons/office.svg",
};
const DEFAULT_FAVICON = "/favicon.svg";

function useModuleFavicon(currentModule: string) {
  useEffect(() => {
    const href = MODULE_FAVICONS[currentModule] ?? DEFAULT_FAVICON;
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/svg+xml";
    link.href = href;
  }, [currentModule]);
}

// Each module gets its own browser tab title so the title reflects the
// active module instead of always showing the generic app name.
const MODULE_TITLES: Record<string, string> = {
  pottery: "Pottery",
  quilting: "Quilting",
  ornaments: "Ornaments",
  travels: "Travels",
  office: "Office",
};
const DEFAULT_TITLE = "Modules";

function useModuleTitle(currentModule: string) {
  useEffect(() => {
    document.title = MODULE_TITLES[currentModule] ?? DEFAULT_TITLE;
  }, [currentModule]);
}

export function ModuleShell({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const currentModule = rootSegment(location);
  useModuleFavicon(currentModule);
  useModuleTitle(currentModule);
  const allGroups = getNavItemsByGroup();

  // Only items whose href belongs to the current module (or are external,
  // e.g. the shared /account settings link) are shown.
  const scopedGroups: Record<string, ResolvedNavEntry[]> = {};
  for (const [group, items] of Object.entries(allGroups)) {
    const filtered = items.filter(
      (item) => item.external || rootSegment(item.href) === currentModule,
    );
    if (filtered.length > 0) scopedGroups[group] = filtered;
  }

  const groupOrder = GROUP_ORDER[currentModule] ?? Object.keys(scopedGroups);
  const groupMeta = GROUP_META[currentModule] ?? {};

  const queryClient = useQueryClient();
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
  const { isDark, toggleTheme } = useTheme();
  const { data: currentUser } = useGetCurrentUser();
  const displayName =
    currentUser?.displayName?.trim() || currentUser?.email || "Account";
  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  function go(item: ResolvedNavEntry) {
    if (item.external) {
      window.location.href = item.href;
    } else {
      navigate(item.href);
    }
  }

  const { tasks } = useBackgroundTasks();
  const hasTasks = tasks.length > 0;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-card-border bg-background/85 backdrop-blur">
        {hasTasks && (
          <div className="h-0.5 w-full overflow-hidden bg-primary/10">
            <div className="h-full bg-primary/70 animate-[progress-bar_1.6s_ease-in-out_infinite]" />
          </div>
        )}
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <AppSwitcher currentAppId={currentModule as AppId} />

          <nav className="hidden items-center gap-1 md:flex">
            {groupOrder.map((group) => {
              const items = scopedGroups[group];
              if (!items || items.length === 0) return null;

              const groupActive = items.some(
                (item) => !item.external && isActive(location, item.href),
              );
              const meta = groupMeta[group] ?? {
                label: group,
                icon: Settings2,
              };
              const Icon = meta.icon;

              const triggerCls = cn(
                "flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium hover-elevate",
                groupActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground",
              );

              // Single-item group -> plain link, no dropdown needed.
              if (items.length === 1) {
                const item = items[0]!;
                return (
                  <button
                    key={group}
                    onClick={() => go(item)}
                    className={triggerCls}
                    data-testid={`navgroup-${group}`}
                  >
                    <Icon className="h-4 w-4" />
                    {meta.label}
                  </button>
                );
              }

              return (
                <DropdownMenu key={group}>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={triggerCls}
                      data-testid={`navgroup-${group}`}
                    >
                      <Icon className="h-4 w-4" />
                      {meta.label}
                      <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {items.map((item) => {
                      const ItemIcon = item.icon;
                      const active =
                        !item.external && isActive(location, item.href);
                      return (
                        <DropdownMenuItem
                          key={item.id}
                          onSelect={() => go(item)}
                          className={cn(active && "text-primary")}
                          data-testid={`navlink-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          <ItemIcon className="mr-2 h-4 w-4 shrink-0" />
                          {item.label}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })}
          </nav>

          <div className="flex items-center gap-1">
            {/* Desktop icon strip — hidden on mobile */}
            <div className="hidden md:flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                aria-label="Toggle dark mode"
                className="text-muted-foreground hover:text-foreground"
              >
                {isDark ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  window.location.href = "/modules/office/gmail";
                }}
                aria-label="Open Gmail"
                className="text-muted-foreground hover:text-foreground"
              >
                <Mail className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  window.location.href = "/modules/travels/travel-calendar";
                }}
                aria-label="Travel Calendar"
                className="text-muted-foreground hover:text-foreground"
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
              <MessengerNavIcon
                buttonClassName="text-muted-foreground hover:text-foreground"
                iconSize={16}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 pl-3 ml-1 border-l border-border outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                    <div className="hidden sm:flex flex-col items-end">
                      <span className="text-sm font-medium leading-none">
                        {displayName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {currentUser?.email}
                      </span>
                    </div>
                    <Avatar className="h-8 w-8 border border-border">
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div className="flex flex-col">
                      <span className="font-medium">{displayName}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {currentUser?.email}
                      </span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      window.location.href = "/account";
                    }}
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    Account settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => logout.mutate()}
                    className="text-destructive focus:text-destructive"
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Hamburger — mobile only */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile navigation drawer */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="right" className="w-72 p-0">
          <SheetHeader className="border-b border-card-border px-4 py-4">
            <SheetTitle className="text-base font-semibold capitalize">
              {MODULE_TITLES[currentModule] ?? "Navigate"}
            </SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-1 p-3">
            {groupOrder.map((group) => {
              const items = scopedGroups[group];
              if (!items || items.length === 0) return null;
              const meta = groupMeta[group] ?? {
                label: group,
                icon: Settings2,
              };
              const Icon = meta.icon;

              if (items.length === 1) {
                const item = items[0]!;
                const active = !item.external && isActive(location, item.href);
                return (
                  <button
                    key={group}
                    onClick={() => {
                      go(item);
                      setMobileNavOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {meta.label}
                  </button>
                );
              }

              // Multi-item group: show group label as a section header, then all items
              return (
                <div key={group}>
                  <p className="mt-2 mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {meta.label}
                  </p>
                  {items.map((item) => {
                    const ItemIcon = item.icon;
                    const active =
                      !item.external && isActive(location, item.href);
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          go(item);
                          setMobileNavOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                          active
                            ? "bg-accent text-accent-foreground font-medium"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                        )}
                      >
                        <ItemIcon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>

      <InstallBanner />

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
