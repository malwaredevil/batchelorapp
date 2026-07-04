import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Home, Globe, Plane, Compass, Star, Upload, LogOut, ChevronDown, MapPin, Settings, CalendarDays, Mail } from "lucide-react";
import { AppSwitcher } from "@/components/AppSwitcher";
import { useLogout, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
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
import { useAuth } from "@/lib/auth";
import { AssistantWidget } from "@/components/assistant/AssistantWidget";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/trips", label: "Trips", icon: Plane },
  { href: "/destinations", label: "Places", icon: MapPin },
  { href: "/map", label: "Map", icon: Globe },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/wishlist", label: "Wishlist", icon: Star },
  { href: "/travel-calendar", label: "Travel Calendar", icon: CalendarDays },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/gmail", label: "Gmail", icon: Mail },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(current: string, href: string) {
  if (href === "/") return current === "/";
  return current === href || current.startsWith(href + "/");
}

export function Layout({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const logout = useLogout({
    mutation: {
      onMutate: async () => {
        await queryClient.cancelQueries();
      },
      onSuccess: () => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), null);
        navigate("/login");
      },
      onError: () => toast.error("Could not sign out. Please try again."),
    },
  });

  if (!user) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-card-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <AppSwitcher />

          <div className="flex items-center gap-1">
            <nav className="mr-1 hidden items-center gap-1 md:flex">
              {NAV_ITEMS.map((item) => {
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
            </nav>

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
            {NAV_ITEMS.map((item) => {
              const active = isActive(location, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-1 px-4 py-1 rounded-xl transition-colors",
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
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 md:pb-8">
        {children}
      </main>

      <AssistantWidget />
    </div>
  );
}
