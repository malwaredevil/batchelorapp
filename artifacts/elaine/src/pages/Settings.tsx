import { ElaineSettingsCard } from "@workspace/elaine-ui";

/**
 * Elaine's dedicated account/config page — the "viewable/editable/savable
 * runtime config" surface for the standalone module. Reuses the same shared
 * card as the hub Account Settings view and Travels' Settings page so there
 * is exactly one implementation of this UI.
 */
export default function Settings() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 font-serif text-2xl text-foreground">
        Elaine settings
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Manage how Elaine behaves across every app in the household.
      </p>
      <ElaineSettingsCard subtitle="Your household's AI assistant — works everywhere" />
    </div>
  );
}
