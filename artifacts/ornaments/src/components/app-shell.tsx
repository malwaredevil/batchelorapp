import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LogOut, Settings, ChevronDown } from "lucide-react";
import { AppSwitcher, SearchTrigger } from "@workspace/elaine-ui";
import { InstallBanner } from "@workspace/web-core";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getNavItemsByGroup } from "@/features/registry";

function isActive(current: string, href: string) {
  if (href === "/") return current === "/";
  return current === href || current.startsWith(href + "/");
}

export function AppShell({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const groups = getNavItemsByGroup();
  const mainNav = groups.main;
  const settingsNav = groups.settings;

  const isSettingsActive = (current: string) =>
    settingsNav.some(
      (s) => current === s.href || current.startsWith(s.href + "/"),
    );
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

  const settingsActive = isSettingsActive(location);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-card-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <AppSwitcher currentAppId="ornaments" />

          <div className="flex items-center gap-1">
            <nav className="mr-1 hidden items-center gap-1 md:flex">
              {mainNav.map((item) => {
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
                    data-testid={`navlink-${item.label.toLowerCase().replace(/\s/g, "-")}`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      "flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                      settingsActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                    data-testid="navlink-settings"
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                    <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {settingsNav.map((item) => (
                    <DropdownMenuItem
                      key={item.href}
                      onClick={() => navigate(item.href)}
                      className={cn(
                        "flex items-center gap-2 cursor-pointer",
                        isActive(location, item.href) && "text-primary",
                      )}
                      data-testid={`navlink-${item.label.toLowerCase()}`}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </nav>

            <SearchTrigger />

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

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-card-border bg-background/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around px-2 py-1.5">
          {mainNav.map((item) => {
            const active = isActive(location, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
                data-testid={`tab-${item.label.toLowerCase().replace(/\s/g, "-")}`}
              >
                <item.icon
                  className={cn(
                    "h-5 w-5",
                    active && "scale-110 transition-transform",
                  )}
                />
                {item.label}
              </Link>
            );
          })}

          <Link
            href="/settings"
            className={cn(
              "flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-colors",
              settingsActive || isActive(location, "/settings")
                ? "text-primary"
                : "text-muted-foreground",
            )}
            data-testid="tab-settings"
          >
            <Settings
              className={cn(
                "h-5 w-5",
                (settingsActive || isActive(location, "/settings")) &&
                  "scale-110 transition-transform",
              )}
            />
            Settings
          </Link>
        </div>
      </nav>
    </div>
  );
}
