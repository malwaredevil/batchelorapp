import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useChangePassword,
  useUpdateCurrentUser,
  useSendPhoneVerificationCode,
  useVerifyPhoneCode,
  useSendTestSms,
  useSendTestEmail,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import {
  ArrowLeft,
  KeyRound,
  Loader2,
  Mail,
  MessageSquareText,
  Moon,
  ShieldCheck,
  Sun,
  User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppLogo } from "@/components/app-logo";
import { useAuth } from "@/lib/auth";
import {
  useTheme,
  ElaineSettingsCard,
  GlobalConfigCard,
} from "@workspace/elaine-ui";
import {
  ReminderEmailCard,
  TimezoneCard,
  GmailSyncCard,
  CalendarSyncCard,
} from "@workspace/travels-settings-ui";
import { usePageAssistantContext } from "@/lib/assistant-context";

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
      onSuccess: async (result) => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), result);
        await queryClient.invalidateQueries({
          queryKey: getGetCurrentUserQueryKey(),
        });
        toast.success("Profile updated.");
      },
      onError: (err: unknown) =>
        toast.error(extractError(err, "Could not update your profile.")),
    },
  });

  const testEmail = useSendTestEmail({
    mutation: {
      onSuccess: () => toast.success(`Test email sent to ${user?.email}.`),
      onError: (err: unknown) =>
        toast.error(extractError(err, "Could not send the test email.")),
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
        <div className="flex gap-3">
          <Button
            type="submit"
            className="flex-1"
            disabled={update.isPending}
            data-testid="button-save-profile"
          >
            {update.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Save profile
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={testEmail.isPending}
            onClick={() => testEmail.mutate()}
            data-testid="button-send-test-email"
          >
            {testEmail.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Mail className="mr-2 h-4 w-4" />
            )}
            Send test email
          </Button>
        </div>
      </form>
    </div>
  );
}

function PhoneCard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);

  const invalidateUser = () =>
    queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });

  const sendCode = useSendPhoneVerificationCode({
    mutation: {
      onSuccess: () => {
        setCodeSent(true);
        toast.success(`Verification code sent to ${phoneNumber}.`);
      },
      onError: (err: unknown) =>
        toast.error(extractError(err, "Could not send the verification code.")),
    },
  });

  const verifyCode = useVerifyPhoneCode({
    mutation: {
      onSuccess: async (result) => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), result);
        await invalidateUser();
        toast.success("Phone number verified.");
        setCodeSent(false);
        setPhoneNumber("");
        setCode("");
      },
      onError: (err: unknown) =>
        toast.error(extractError(err, "That code didn't work.")),
    },
  });

  const testSms = useSendTestSms({
    mutation: {
      onSuccess: () => toast.success("Test SMS sent — check your phone."),
      onError: (err: unknown) =>
        toast.error(extractError(err, "Could not send the test SMS.")),
    },
  });

  function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = phoneNumber.trim();
    if (!trimmed) return;
    if (!smsConsent) {
      toast.error("Please check the box to agree to receive SMS messages.");
      return;
    }
    sendCode.mutate({ data: { phoneNumber: trimmed, consent: true } });
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim().length !== 6) {
      toast.error("Enter the 6-digit code.");
      return;
    }
    verifyCode.mutate({ data: { code: code.trim() } });
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <MessageSquareText className="h-5 w-5" />
        Phone &amp; SMS
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Verify a phone number to receive Travels reminders by text. See our{" "}
        <a
          href={`${base}modules/travels/privacy`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          Privacy Policy
        </a>{" "}
        for details on how your phone number is used.
      </p>

      {user?.phoneVerified && user?.phoneNumber ? (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-card-border bg-muted/40 p-3">
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-green-600" />
            <span className="font-medium">{user.phoneNumber}</span>
            <span className="text-xs text-muted-foreground">Verified</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testSms.isPending}
            onClick={() => testSms.mutate()}
            data-testid="button-send-test-sms"
          >
            {testSms.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Send test SMS
          </Button>
        </div>
      ) : null}

      {!codeSent ? (
        <form onSubmit={handleSendCode} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {user?.phoneVerified ? "Change phone number" : "Phone number"}
            </Label>
            <Input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+12105551234"
              data-testid="input-phone-number"
            />
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-card-border bg-muted/30 p-3">
            <Checkbox
              id="sms-consent"
              checked={smsConsent}
              onCheckedChange={(checked) => setSmsConsent(checked === true)}
              data-testid="checkbox-sms-consent"
              className="mt-0.5"
            />
            <Label
              htmlFor="sms-consent"
              className="text-xs font-normal leading-relaxed text-muted-foreground"
            >
              I agree to receive SMS text messages from Batchelor App at the
              phone number above, including verification codes and Travels trip
              reminders. Message and data rates may apply. Message frequency
              varies. Reply STOP to opt out at any time, or HELP for help. See
              our{" "}
              <a
                href={`${base}modules/travels/privacy`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Privacy Policy
              </a>
              .
            </Label>
          </div>
          <Button
            type="submit"
            variant="secondary"
            className="w-full"
            disabled={sendCode.isPending || !phoneNumber.trim() || !smsConsent}
            data-testid="button-send-phone-code"
          >
            {sendCode.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Send verification code
          </Button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Enter the 6-digit code sent to {phoneNumber}
            </Label>
            <Input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              data-testid="input-phone-code"
            />
          </div>
          <div className="flex gap-3">
            <Button
              type="submit"
              className="flex-1"
              disabled={verifyCode.isPending || code.trim().length !== 6}
              data-testid="button-verify-phone-code"
            >
              {verifyCode.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Verify
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCodeSent(false);
                setCode("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();

  const update = useUpdateCurrentUser({
    mutation: {
      onSuccess: (result) => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), result);
        void queryClient.invalidateQueries({
          queryKey: getGetCurrentUserQueryKey(),
        });
      },
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
  const { user } = useAuth();

  usePageAssistantContext(
    "hub-account",
    `On the shared Account settings page (profile, phone/SMS, appearance, password, and Elaine assistant settings — shared across every app). Signed in as ${user?.email ?? "unknown"}${user?.phoneVerified ? `, with a verified phone number (${user.phoneNumber})` : ", with no verified phone number yet"}.`,
  );

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
          <PhoneCard />
          <AppearanceCard />
          <PasswordCard />
          <ElaineSettingsCard subtitle="Your household's AI assistant across every app" />
        </div>
        <GlobalConfigCard />

        <div className="mx-auto w-full max-w-xl space-y-4 pt-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Travels</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Reminder emails, timezone, Gmail scanning, and Google Calendar
              connections for the Travels app.
            </p>
          </div>
          <div className="space-y-6">
            <ReminderEmailCard />
            <TimezoneCard />
            <GmailSyncCard usePageContext={usePageAssistantContext} />
            <CalendarSyncCard usePageContext={usePageAssistantContext} />
          </div>
        </div>

        {user?.isOwner && (
          <div className="mx-auto w-full max-w-xl space-y-4 pt-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Developer
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Owner-only tools.
              </p>
            </div>
            <Link
              href="/control-panel"
              className="flex w-full items-center justify-between rounded-lg border border-card-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/60"
            >
              Control Panel
              <span className="text-xs text-muted-foreground">
                AI timeouts &amp; token limits
              </span>
            </Link>
            <Link
              href="/google-apis-demo"
              className="flex w-full items-center justify-between rounded-lg border border-card-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/60"
            >
              Google APIs demo
            </Link>
          </div>
        )}

        <p className="pt-2 text-center text-xs text-muted-foreground">
          Signed in to {base.replace(/\/$/, "") || "/"} · one account, every
          collection
        </p>
      </main>
    </div>
  );
}
