import { Link, useLocation } from "wouter";
import { LogOut, Sun, Moon, Mail, CalendarDays, Settings } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useLogout,
  useGetCurrentUser,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import {
  AppSwitcher,
  ElaineAvatar,
  ElaineWordmark,
  useTheme,
  SearchTrigger,
} from "@workspace/elaine-ui";
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
import { cn } from "@/lib/utils";
import { getNavItemsByGroup } from "@/features/registry";

function isActive(current: string, href: string) {
  if (href === "/") return current === "/";
  return current === href || current.startsWith(href + "/");
}

/**
 * Header for the standalone Elaine module. Mirrors Pottery/Quilting/Travels'
 * header conventions (sticky, app-switcher-style back-to-hub link, nav,
 * sign out) but scoped to Elaine's own two surfaces: full chat and settings.
 */
export function Header() {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const { isDark, toggleTheme } = useTheme();
  const mainNav = getNavItemsByGroup().main;
  const { data: currentUser } = useGetCurrentUser();
  const displayName =
    currentUser?.displayName?.trim() || currentUser?.email || "Account";
  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
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
    <header className="sticky top-0 z-40 border-b border-card-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <AppSwitcher currentAppId="elaine" />

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 sm:flex">
            <ElaineAvatar size={28} />
            <ElaineWordmark className="text-lg" />
          </div>

          <nav className="flex items-center gap-1">
            {mainNav.map((item) => {
              const linkClassName = cn(
                "flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                !item.external && isActive(location, item.href)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              );
              if (item.external) {
                // Crosses an artifact boundary (e.g. the hub's unified
                // /account settings page) — must be a full browser
                // navigation, not client-side routing.
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className={linkClassName}
                    data-testid={item.testId}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="hidden md:inline">{item.label}</span>
                  </a>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={linkClassName}
                  data-testid={item.testId}
                >
                  <item.icon className="h-4 w-4" />
                  <span className="hidden md:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <SearchTrigger />

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            className="text-muted-foreground hover:text-foreground"
            data-testid="button-toggle-theme"
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
                disabled={logout.isPending}
                className="text-destructive focus:text-destructive"
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
