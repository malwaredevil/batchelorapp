import { useState } from "react";
import { useLocation } from "wouter";
import { useResetPassword } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { AppLogo } from "@/components/app-logo";

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);

  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const resetPassword = useResetPassword({
    mutation: {
      onSuccess: () => {
        setDone(true);
        setTimeout(() => {
          window.location.href = "/login";
        }, 2500);
      },
      onError: (err: unknown) => {
        const message =
          err &&
          typeof err === "object" &&
          "response" in err &&
          err.response &&
          typeof err.response === "object" &&
          "data" in err.response &&
          err.response.data &&
          typeof err.response.data === "object" &&
          "error" in err.response.data &&
          typeof (err.response.data as { error: unknown }).error === "string"
            ? (err.response.data as { error: string }).error
            : "This reset link is invalid or has expired.";
        toast.error(message);
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      toast.error("No reset token found. Please use the link from your email.");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    resetPassword.mutate({ data: { token, newPassword: password } });
  }

  if (!token) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm space-y-8 text-center">
          <AppLogo className="mx-auto h-16 w-16 drop-shadow-sm" />
          <p className="text-sm text-muted-foreground">
            Invalid reset link. Please request a new one.
          </p>
          <Button
            variant="outline"
            className="h-11 w-full font-semibold"
            onClick={() => navigate("/forgot-password")}
          >
            Request a new link
          </Button>
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
            {done ? "Password reset!" : "Choose a new password"}
          </h1>
          {done && (
            <p className="text-sm text-muted-foreground">
              All done — redirecting you to sign in…
            </p>
          )}
        </div>

        {!done && (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-xl border border-card-border bg-card p-6 shadow-sm"
          >
            <div className="space-y-2">
              <Label
                htmlFor="password"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                New password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="h-11 bg-muted/60"
                data-testid="input-password"
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="confirm"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Confirm password
              </Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                className="h-11 bg-muted/60"
                data-testid="input-confirm"
              />
            </div>

            <Button
              type="submit"
              className="h-11 w-full font-semibold"
              disabled={resetPassword.isPending}
              data-testid="button-reset"
            >
              {resetPassword.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Reset password
            </Button>
          </form>
        )}

        <p className="text-center text-xs font-medium text-muted-foreground">
          A private catalogue for two.
        </p>
      </div>
    </div>
  );
}
