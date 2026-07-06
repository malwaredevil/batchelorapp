import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useChangePassword,
  useUpdateCurrentUser,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import {
  ArrowLeft,
  KeyRound,
  Loader2,
  Moon,
  Sun,
  User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppLogo } from "@/components/app-logo";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/hooks/use-theme";
import { ElaineSettingsCard, GlobalConfigCard } from "@workspace/elaine-ui";

const base = import.meta.env.BASE_URL;

function extractError(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null && "response" in err) {
    const data = (err as { response?: { data?: { error?: string } } }).response
      ?.data;
    if (data?.error) return data.error;
  }
  return fallback;
}

function ProfileCard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");

  const update = useUpdateCurrentUser({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: getGetCurrentUserQueryKey(),
        });
        toast.success("Profile updated.");
      },
      onError: (err: unknown) =>
        toast.error(extractError(err, "Could not update your profile.")),
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    update.mutate({ data: { displayName: displayName.trim() || null } });
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 shadow-sm">
      <div className="mb-5 flex items-center gap-2 font-semibold">
        <UserIcon className="h-5 w-5" />
        Profile
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Email
          </Label>
          <Input value={user?.email ?? ""} disabled readOnly />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Display name
          </Label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How your name appears across the apps"
            maxLength={100}
            data-testid="input-display-name"
          />
        </div>
        <Button
          type="submit"
          className="w-full"
          disabled={update.isPending}
          data-testid="button-save-profile"
        >
          {update.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          Save profile
        </Button>
      </form>
    </div>
  );
}

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

  const options: {
    value: "light" | "dark";
    label: string;
    icon: typeof Sun;
  }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ];

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        {theme === "dark" ? (
          <Moon className="h-5 w-5" />
        ) : (
          <Sun className="h-5 w-5" />
        )}
        Appearance
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Your theme follows your account across both apps.
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

function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const changePassword = useChangePassword({
    mutation: {
      onSuccess: () => {
        toast.success("Password updated successfully.");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      },
      onError: (err: unknown) =>
        toast.error(extractError(err, "Could not update password.")),
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match.");
      return;
    }
    changePassword.mutate({ data: { currentPassword, newPassword } });
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 shadow-sm">
      <div className="mb-5 flex items-center gap-2 font-semibold">
        <KeyRound className="h-5 w-5" />
        Change password
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Current password
          </Label>
          <Input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            New password
          </Label>
          <Input
            type="password"
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Confirm new password
          </Label>
          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </div>
        <Button
          type="submit"
          className="w-full"
          disabled={changePassword.isPending}
        >
          {changePassword.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          Update password
        </Button>
      </form>
    </div>
  );
}

export default function Account() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-6 py-4 backdrop-blur-md">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to apps
        </Link>
        <div className="flex items-center gap-2">
          <AppLogo className="h-7 w-7" />
          <span className="font-semibold tracking-tight text-primary">
            Batchelor
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your profile, appearance, and password — shared across all
            your collections.
          </p>
        </div>
        <div className="mx-auto w-full max-w-xl space-y-6">
          <ProfileCard />
          <AppearanceCard />
          <PasswordCard />
          <ElaineSettingsCard subtitle="Your household's AI assistant across every app" />
        </div>
        <GlobalConfigCard />
        <p className="pt-2 text-center text-xs text-muted-foreground">
          Signed in to {base.replace(/\/$/, "") || "/"} · one account, every
          collection
        </p>
      </main>
    </div>
  );
}
