import { type ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Home,
  Globe,
  Plane,
  Compass,
  Star,
  LogOut,
  ChevronDown,
  MapPin,
  Settings,
  CalendarDays,
  Mail,
  Menu,
  Sparkles,
} from "lucide-react";
import { AppSwitcher, SearchTrigger } from "@workspace/elaine-ui";
import {
  useLogout,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
  SheetClose,
} from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { InstallBanner } from "@workspace/web-core";
import { AssistantWidget } from "@/components/assistant/AssistantWidget";

type NavItem = { href: string; label: string; icon: typeof Home };

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/trips", label: "Trips", icon: Plane },
];

const DISCOVER_NAV_ITEMS: NavItem[] = [
  { href: "/destinations", label: "Places", icon: MapPin },
  { href: "/map", label: "Map", icon: Globe },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/wishlist", label: "Wishlist", icon: Star },
];

const PLAN_NAV_ITEMS: NavItem[] = [
  { href: "/travel-calendar", label: "Travel Calendar", icon: CalendarDays },
  { href: "/gmail", label: "Gmail", icon: Mail },
];

const ACCOUNT_NAV_ITEMS: NavItem[] = [
  { href: "/google-apis", label: "Google APIs", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
];

const ALL_NAV_ITEMS: NavItem[] = [
  ...PRIMARY_NAV_ITEMS,
  ...DISCOVER_NAV_ITEMS,
  ...PLAN_NAV_ITEMS,
  ...ACCOUNT_NAV_ITEMS,
];

// Curated subset shown directly in the mobile bottom nav; everything else lives in "More".
const MOBILE_PRIMARY_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/trips", label: "Trips", icon: Plane },
  { href: "/travel-calendar", label: "Calendar", icon: CalendarDays },
  { href: "/gmail", label: "Gmail", icon: Mail },
];

const MOBILE_MORE_ITEMS: NavItem[] = ALL_NAV_ITEMS.filter(
  (item) => !MOBILE_PRIMARY_ITEMS.some((p) => p.href === item.href),
);

function isActive(current: string, href: string) {
  if (href === "/") return current === "/";
  return current === href || current.startsWith(href + "/");
}

function NavGroupMenu({
  label,
  icon: Icon,
  items,
  location,
}: {
  label: string;
  icon: typeof Home;
  items: NavItem[];
  location: string;
}) {
  const groupActive = items.some((item) => isActive(location, item.href));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
            groupActive
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {items.map((item) => {
          const active = isActive(location, item.href);
          return (
            <DropdownMenuItem
              key={item.href}
              asChild
              className="cursor-pointer"
            >
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-2",
                  active && "text-primary font-medium",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [moreOpen, setMoreOpen] = useState(false);
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

  if (!user) {
    return <>{children}</>;
  }

  const moreActive = MOBILE_MORE_ITEMS.some((item) =>
    isActive(location, item.href),
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-card-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <AppSwitcher currentAppId="travels" />

          <div className="flex items-center gap-1">
            <nav className="mr-1 hidden items-center gap-1 md:flex">
              {PRIMARY_NAV_ITEMS.map((item) => {
                const active = isActive(location, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
              <NavGroupMenu
                label="Discover"
                icon={Compass}
                items={DISCOVER_NAV_ITEMS}
                location={location}
              />
              <NavGroupMenu
                label="Plan"
                icon={CalendarDays}
                items={PLAN_NAV_ITEMS}
                location={location}
              />
            </nav>

            <SearchTrigger />

            <Link href="/travel-calendar">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-9 w-9",
                  isActive(location, "/travel-calendar")
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground",
                )}
                title="Travel Calendar"
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
            </Link>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground"
                >
                  <span className="hidden sm:inline text-sm font-medium">
                    {user.displayName || user.email}
                  </span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                  Account
                </DropdownMenuLabel>
                <DropdownMenuItem asChild className="cursor-pointer">
                  <Link href="/settings" className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive cursor-pointer"
                  onSelect={() => logout.mutate(undefined)}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-card-border bg-background/90 backdrop-blur">
          <div className="flex items-center justify-around py-2">
            {MOBILE_PRIMARY_ITEMS.map((item) => {
              const active = isActive(location, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-1 px-3 py-1 rounded-xl transition-colors",
                    active
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </Link>
              );
            })}
            <button
              onClick={() => setMoreOpen(true)}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-1 rounded-xl transition-colors",
                moreActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Menu className="h-5 w-5" />
              <span className="text-[10px] font-medium">More</span>
            </button>
          </div>
        </nav>

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="bottom" className="md:hidden rounded-t-2xl pb-8">
            <SheetHeader className="text-left">
              <SheetTitle>More</SheetTitle>
            </SheetHeader>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {MOBILE_MORE_ITEMS.map((item) => {
                const active = isActive(location, item.href);
                return (
                  <SheetClose asChild key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-xl border border-card-border p-3 text-center transition-colors",
                        active
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      <span className="text-xs font-medium">{item.label}</span>
                    </Link>
                  </SheetClose>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </header>
      <InstallBanner />

      <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 md:pb-8">
        {children}
      </main>

      <AssistantWidget />
    </div>
  );
}
