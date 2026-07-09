import { Link, useLocation } from "wouter";
import { LogOut, Sun, Moon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useLogout,
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
            {mainNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                  isActive(location, item.href)
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                data-testid={item.testId}
              >
                <item.icon className="h-4 w-4" />
                <span className="hidden md:inline">{item.label}</span>
              </Link>
            ))}
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
  );
}
