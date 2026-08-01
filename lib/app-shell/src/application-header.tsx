import { Component, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  LogOut,
  Mail,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { toast } from "sonner";
import type { AuthUser } from "@workspace/api-client-react";
import {
  getGetCurrentUserQueryKey,
  useGetCurrentUser,
  useLogout,
} from "@workspace/api-client-react";
import { AppSwitcher, type AppId, useTheme } from "@workspace/elaine-ui";
import { MessengerNavIcon } from "@workspace/messenger-ui";
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui";
import { cn } from "@workspace/web-core/utils";

/** Prevents a MessengerNavIcon crash from taking down the whole app header. */
class MessengerErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[MessengerErrorBoundary] Caught error:", error.message, "\nComponent stack:", info.componentStack);
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function currentReturnPath() {
  return window.location.pathname + window.location.search;
}

function ownerPanelHref() {
  return `/owner-panel?from=${encodeURIComponent(currentReturnPath())}`;
}

function initialsFor(user: AuthUser | null | undefined) {
  const displayName = user?.displayName?.trim() || user?.email || "Account";
  return displayName
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export interface AccountMenuProps {
  user?: AuthUser | null;
  signingOut?: boolean;
  onNavigate?: (href: string) => void;
  onSignOut?: () => void;
  className?: string;
}

/**
 * The one account menu used by every authenticated Batchelor App SPA.
 * Owner-only entries belong here so a future menu change cannot drift by app.
 */
export function AccountMenu({
  user,
  signingOut = false,
  onNavigate = (href) => {
    window.location.href = href;
  },
  onSignOut = () => undefined,
  className,
}: AccountMenuProps) {
  const displayName = user?.displayName?.trim() || user?.email || "Account";

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Open account menu for ${displayName}`}
          className={cn(
            "ml-1 flex items-center gap-2 rounded-sm border-l border-border pl-3 outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <div className="hidden flex-col items-end sm:flex">
            <span className="text-sm font-medium leading-none">
              {displayName}
            </span>
            <span className="text-xs text-muted-foreground">{user?.email}</span>
          </div>
          <Avatar className="h-8 w-8 border border-border">
            <AvatarFallback className="bg-primary text-xs text-primary-foreground">
              {initialsFor(user)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="font-medium">{displayName}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {user?.email}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onNavigate("/account")}>
          <Settings className="mr-2 h-4 w-4" />
          Account settings
        </DropdownMenuItem>
        {user?.isOwner && (
          <DropdownMenuItem onSelect={() => onNavigate(ownerPanelHref())}>
            <ShieldCheck className="mr-2 h-4 w-4" />
            Owner Panel
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onSignOut}
          disabled={signingOut}
          className="text-destructive focus:text-destructive"
          data-testid="button-logout"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface ApplicationHeaderProps {
  currentAppId: AppId;
  /** App-owned navigation rendered between the switcher and global actions. */
  navigation?: ReactNode;
  /** App-owned action such as Hub search, rendered before global actions. */
  primaryAction?: ReactNode;
  /** Optional global indicator, normally the Modules notification bell. */
  notificationAction?: ReactNode;
  /** Mobile-only app navigation trigger, normally the Modules hamburger. */
  mobileNavigationAction?: ReactNode;
  /** Optional thin progress indicator above the header row. */
  progressIndicator?: ReactNode;
  headerClassName?: string;
  containerClassName?: string;
  navigationClassName?: string;
  /** Use `always` only when the app's compact nav is designed for phones. */
  navigationVisibility?: "desktop" | "always";
  globalIconSize?: number;
}

/**
 * Shared global chrome for Hub, Modules, and Elaine.
 *
 * Apps compose their own navigation/actions into typed slots. Authentication,
 * owner visibility, global shortcuts, theme, Messenger, and sign-out stay
 * centralized and cannot drift between artifacts.
 */
export function ApplicationHeader({
  currentAppId,
  navigation,
  primaryAction,
  notificationAction,
  mobileNavigationAction,
  progressIndicator,
  headerClassName,
  containerClassName,
  navigationClassName,
  navigationVisibility = "desktop",
  globalIconSize = 16,
}: ApplicationHeaderProps) {
  const queryClient = useQueryClient();
  const { data: currentUser } = useGetCurrentUser();
  const { isDark, toggleTheme } = useTheme();
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
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-card-border bg-background/85 backdrop-blur",
        headerClassName,
      )}
      data-shared-application-header={currentAppId}
    >
      {progressIndicator}
      <div
        className={cn(
          "mx-auto flex h-16 max-w-6xl items-center justify-between px-4",
          containerClassName,
        )}
      >
        <AppSwitcher currentAppId={currentAppId} />

        {navigation && (
          <div
            className={cn(
              "min-w-0 flex-1 justify-center",
              navigationVisibility === "desktop" ? "hidden md:flex" : "flex",
              navigationClassName,
            )}
          >
            {navigation}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1">
          {primaryAction}
          <div className="hidden items-center gap-1 md:flex">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label="Toggle dark mode"
              className="text-muted-foreground hover:text-foreground"
              data-testid="button-toggle-theme"
            >
              {isDark ? (
                <Sun
                  style={{ width: globalIconSize, height: globalIconSize }}
                />
              ) : (
                <Moon
                  style={{ width: globalIconSize, height: globalIconSize }}
                />
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
              <Mail style={{ width: globalIconSize, height: globalIconSize }} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                window.location.href = "/modules/office/calendar";
              }}
              aria-label="Calendar"
              className="text-muted-foreground hover:text-foreground"
            >
              <CalendarDays
                style={{ width: globalIconSize, height: globalIconSize }}
              />
            </Button>
            {notificationAction}
            <MessengerErrorBoundary>
              <MessengerNavIcon
                buttonClassName="text-muted-foreground hover:text-foreground"
                iconSize={globalIconSize}
              />
            </MessengerErrorBoundary>
          </div>
          <AccountMenu
            user={currentUser}
            signingOut={logout.isPending}
            onSignOut={() => logout.mutate()}
          />
          {mobileNavigationAction}
        </div>
      </div>
    </header>
  );
}
