import { Sun, Moon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ElaineSettingsCard, useTheme } from "@workspace/elaine-ui";
import {
  useGetCurrentUser,
  useUpdateCurrentUser,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";

function extractError(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
  }
  return fallback;
}

/**
 * Mirrors the Hub's AppearanceCard so switching light/dark from Elaine feels
 * identical to switching it anywhere else in the household's app family.
 */
function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();

  const update = useUpdateCurrentUser({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: getGetCurrentUserQueryKey(),
        }),
      onError: (err: unknown) =>
        toast.error(extractError(err, "Could not save your theme.")),
    },
  });

  function choose(next: "light" | "dark") {
    setTheme(next);
    update.mutate({ data: { themePreference: next } });
  }

  const options: { value: "light" | "dark"; label: string; icon: typeof Sun }[] =
    [
      { value: "light", label: "Light", icon: Sun },
      { value: "dark", label: "Dark", icon: Moon },
    ];

  return (
    <div className="rounded-2xl border border-card-border bg-card p-6">
      <div className="mb-1 flex items-center gap-2 font-serif text-lg text-foreground">
        {theme === "dark" ? (
          <Moon className="h-5 w-5" />
        ) : (
          <Sun className="h-5 w-5" />
        )}
        Appearance
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Your theme follows your account across every app.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => {
          const Icon = opt.icon;
          const active = theme === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => choose(opt.value)}
              aria-pressed={active}
              data-testid={`button-theme-${opt.value}`}
              className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-card-border text-muted-foreground hover:bg-muted/60"
              }`}
            >
              <Icon className="h-4 w-4" />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Elaine's dedicated account/config page. Per-user assistant preferences
 * live here; the app-owner-only Global Configuration (models, timeouts,
 * feature toggles, thresholds spanning every app) lives on the hub at
 * `/account` since it isn't Elaine-specific — this page just links there.
 */
export default function Settings() {
  const { data: user } = useGetCurrentUser();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 font-serif text-2xl text-foreground">
        Elaine settings
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Manage how Elaine behaves across every app in the household.
      </p>
      <div className="space-y-6">
        <AppearanceCard />
        <ElaineSettingsCard subtitle="Your household's AI assistant — works everywhere" />
        {user?.isOwner && (
          <div className="rounded-2xl border border-card-border bg-card p-6">
            <h2 className="font-serif text-lg text-foreground">
              Global configuration
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Models, timeouts, feature toggles, and thresholds across every
              app live on your account page.
            </p>
            <button
              type="button"
              className="text-sm font-medium text-primary underline underline-offset-4"
              onClick={() => {
                window.location.href = "/account";
              }}
            >
              Open global configuration →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
