import { useState } from "react";
import { useLocation } from "wouter";
import { useForgotPassword } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { AppLogo } from "@/components/app-logo";

export default function ForgotPassword() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const forgotPassword = useForgotPassword({
    mutation: {
      onSuccess: () => {
        setSubmitted(true);
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
    if (!email.trim()) return;
    forgotPassword.mutate({ data: { email: email.trim() } });
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

        {submitted ? (
          <div className="space-y-4 rounded-xl border border-card-border bg-card p-6 shadow-sm text-center">
            <MailCheck className="mx-auto h-10 w-10 text-primary" />
            <h2 className="text-lg font-semibold">Check your email</h2>
            <p className="text-sm text-muted-foreground">
              If <strong>{email}</strong> is registered, you'll receive a
              password reset link shortly. It expires in 30 minutes.
            </p>
            <p className="text-xs text-muted-foreground">
              Check your spam folder if it doesn't arrive.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                window.location.href = "/login";
              }}
            >
              Back to sign in
            </Button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-xl border border-card-border bg-card p-6 shadow-sm"
          >
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Forgot your password?</h2>
              <p className="text-sm text-muted-foreground">
                Enter your email and we'll send you a reset link.
              </p>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="email"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11 bg-muted/60"
                autoFocus
              />
            </div>

            <Button
              type="submit"
              className="h-11 w-full font-semibold"
              disabled={forgotPassword.isPending}
            >
              {forgotPassword.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Send reset link
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full gap-1 text-sm text-muted-foreground"
              onClick={() => {
                window.location.href = "/login";
              }}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to sign in
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
