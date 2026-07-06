import { ElaineSettingsCard } from "@workspace/elaine-ui";
import { useGetCurrentUser } from "@workspace/api-client-react";

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
