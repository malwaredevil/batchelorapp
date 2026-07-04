import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useResetPassword } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { AppLogo } from "@/components/app-logo";

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [done, setDone] = useState(false);
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    if (!token) {
      toast.error("Invalid or missing reset link.");
    }
  }, [token]);

  const resetPassword = useResetPassword({
    mutation: {
      onSuccess: () => {
        setDone(true);
      },
      onError: (err: unknown) => {
        const msg =
          (err as { data?: { error?: string } })?.data?.error ??
          "Something went wrong. Please try again.";
        toast.error(msg);
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError("");

    if (newPassword.length < 8) {
      setValidationError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setValidationError("Passwords do not match.");
      return;
    }
    if (!token) {
      toast.error("Invalid or missing reset link.");
      return;
    }

    resetPassword.mutate({ data: { token, newPassword } });
  }

  if (!token) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-3 text-center">
            <AppLogo className="mx-auto h-16 w-16 drop-shadow-sm" />
          </div>
          <div className="space-y-4 rounded-xl border border-card-border bg-card p-6 shadow-sm text-center">
            <XCircle className="mx-auto h-10 w-10 text-destructive" />
            <h2 className="text-lg font-semibold">Invalid reset link</h2>
            <p className="text-sm text-muted-foreground">
              This link is invalid or has already been used. Request a new one
              from the login page.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate("/forgot-password")}
            >
              Request new link
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-3 text-center">
          <AppLogo className="mx-auto h-16 w-16 drop-shadow-sm" />
          <h1 className="text-2xl font-bold tracking-tight">
            Ashley's Quilting Center
          </h1>
          <p className="text-sm text-muted-foreground">Quilting Studio</p>
        </div>

        {done ? (
          <div className="space-y-4 rounded-xl border border-card-border bg-card p-6 shadow-sm text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
            <h2 className="text-lg font-semibold">Password updated</h2>
            <p className="text-sm text-muted-foreground">
              Your password has been changed successfully. You can now sign in
              with your new password.
            </p>
            <Button
              className="w-full"
              onClick={() => {
                window.location.href = "/login";
              }}
            >
              Sign in
            </Button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-xl border border-card-border bg-card p-6 shadow-sm"
          >
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Choose a new password</h2>
              <p className="text-sm text-muted-foreground">
                Must be at least 8 characters.
              </p>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="new-password"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                New password
              </Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="h-11 bg-muted/60"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="confirm-password"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Confirm password
              </Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="h-11 bg-muted/60"
              />
            </div>

            {validationError && (
              <p className="text-sm text-destructive">{validationError}</p>
            )}

            <Button
              type="submit"
              className="h-11 w-full font-semibold"
              disabled={resetPassword.isPending}
            >
              {resetPassword.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Set new password
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
