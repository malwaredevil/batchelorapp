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
  useGetCalendarStatus,
  useDisconnectCalendar,
  getGetCalendarStatusQueryKey,
} from "@workspace/api-client-react";
import { useGmailStatus, useGmailDisconnect } from "@workspace/gmail-ui";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Cake,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  KeyRound,
  Loader2,
  Mail,
  MessageSquareText,
  Moon,
  RefreshCw,
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
import { useTheme, ElaineSettingsCard } from "@workspace/elaine-ui";
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

const BIRTHDAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function formatBirthdayDisplay(mmdd: string): string {
  const [mm, dd] = mmdd.split("-");
  const date = new Date(2000, Number(mm) - 1, Number(dd));
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function ProfileCard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [birthday, setBirthday] = useState(user?.birthday ?? "");

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
    const trimmedBirthday = birthday.trim();
    if (trimmedBirthday && !BIRTHDAY_RE.test(trimmedBirthday)) {
      toast.error(
        "Birthday must be in MM-DD format, e.g. 03-15 for March 15th.",
      );
      return;
    }
    update.mutate({
      data: {
        displayName: displayName.trim() || null,
        birthday: trimmedBirthday || null,
      },
    });
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
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Cake className="h-3.5 w-3.5" />
              Birthday
            </span>
          </Label>
          <Input
            value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
            placeholder="MM-DD (e.g. 03-15 for March 15th)"
            maxLength={5}
            data-testid="input-birthday"
          />
          {birthday && BIRTHDAY_RE.test(birthday.trim()) && (
            <p className="text-xs text-muted-foreground">
              {formatBirthdayDisplay(birthday.trim())} — Elaine will send you a
              birthday email and a banner will appear when you log in! 🎂
            </p>
          )}
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

function GoogleCalendarCard() {
  const qc = useQueryClient();
  const { data: status, isLoading } = useGetCalendarStatus();
  const disconnect = useDisconnectCalendar({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetCalendarStatusQueryKey() });
        toast.success("Google Calendar disconnected.");
      },
      onError: () => toast.error("Could not disconnect Google Calendar."),
    },
  });

  const returnTo = `${base.replace(/\/$/, "")}/account`;
  const connectUrl = `/api/travels/google-calendar/connect?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <CalendarDays className="h-5 w-5" />
        Google Calendar
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Link your Google account to sync Travels trips and reminders to your
        calendar.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking…
        </div>
      ) : status?.connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-card-border bg-muted/40 p-3">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
            <span className="flex-1 truncate text-sm font-medium">
              {status.googleEmail ?? "Connected"}
            </span>
          </div>
          <div className="flex gap-2">
            <a
              href={`${base.replace(/\/$/, "")}/modules/travels/settings`}
              className="flex-1"
            >
              <Button variant="outline" size="sm" className="w-full gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" />
                Manage in Travels
              </Button>
            </a>
            <Button
              variant="ghost"
              size="sm"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
              className="text-destructive hover:text-destructive"
            >
              {disconnect.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Disconnect"
              )}
            </Button>
          </div>
        </div>
      ) : (
        <a href={connectUrl}>
          <Button className="gap-2">
            <CalendarDays className="h-4 w-4" />
            Connect Google Calendar
          </Button>
        </a>
      )}
    </div>
  );
}

function GmailConnectionCard() {
  const { data: status, isLoading } = useGmailStatus();
  const disconnect = useGmailDisconnect();

  const returnTo = `${base.replace(/\/$/, "")}/account`;
  const connectUrl = `/api/gmail/connect?returnTo=${encodeURIComponent(returnTo)}`;

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      toast.success("Gmail disconnected.");
    } catch {
      toast.error("Could not disconnect Gmail.");
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <Mail className="h-5 w-5" />
        Gmail
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Connect your Gmail account to access your inbox right inside Batchelor
        Office.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking…
        </div>
      ) : status?.connected && status.tokenExpired ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
            <div className="text-sm">
              <p className="font-medium text-amber-800">Access expired</p>
              <p className="text-xs text-amber-700">
                Google revoked access — click below to reconnect. Your emails
                are untouched.
              </p>
            </div>
          </div>
          <a href={connectUrl}>
            <Button className="gap-2 bg-amber-600 hover:bg-amber-700 text-white">
              <RefreshCw className="h-4 w-4" />
              Reconnect Gmail
            </Button>
          </a>
        </div>
      ) : status?.connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-card-border bg-muted/40 p-3">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
            <span className="flex-1 truncate text-sm font-medium">
              {status.email ?? "Connected"}
            </span>
          </div>
          <div className="flex gap-2">
            <a
              href={`${base.replace(/\/$/, "")}/modules/office/gmail`}
              className="flex-1"
            >
              <Button variant="outline" size="sm" className="w-full gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" />
                Open Gmail
              </Button>
            </a>
            <Button
              variant="ghost"
              size="sm"
              disabled={disconnect.isPending}
              onClick={() => void handleDisconnect()}
              className="text-destructive hover:text-destructive"
            >
              {disconnect.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Disconnect"
              )}
            </Button>
          </div>
        </div>
      ) : (
        <a href={connectUrl}>
          <Button className="gap-2">
            <Mail className="h-4 w-4" />
            Connect Gmail
          </Button>
        </a>
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
          <GoogleCalendarCard />
          <GmailConnectionCard />
          <AppearanceCard />
          <PasswordCard />
          <ElaineSettingsCard subtitle="Your household's AI assistant across every app" />
        </div>

        {user?.isOwner && (
          <div className="mx-auto w-full max-w-xl">
            <Link
              href="/owner-panel"
              className="flex w-full items-center justify-between rounded-xl border border-card-border bg-card px-5 py-4 text-sm font-medium transition-colors hover:bg-muted/60"
            >
              <div>
                <p className="font-semibold">Owner Panel</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Travels settings, AI configuration &amp; developer tools
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
