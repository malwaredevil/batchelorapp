import { useState } from "react";
import { useForgotPassword } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft } from "lucide-react";
import { AppLogo } from "@/components/app-logo";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const forgotPassword = useForgotPassword({
    mutation: {
      onSuccess: () => {
        setSubmitted(true);
      },
      onError: () => {
        toast.error("Something went wrong. Please try again.");
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
            Forgot password?
          </h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we'll send you a reset link.
          </p>
        </div>

        {submitted ? (
          <div className="rounded-xl border border-card-border bg-card p-6 shadow-sm space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              If that email is in our system, a reset link is on its way. Check
              your inbox (and spam folder).
            </p>
            <a href="/login">
              <Button
                variant="outline"
                className="w-full h-11 gap-2 font-semibold"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </Button>
            </a>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-xl border border-card-border bg-card p-6 shadow-sm"
          >
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
                data-testid="input-email"
              />
            </div>

            <Button
              type="submit"
              className="h-11 w-full font-semibold"
              disabled={forgotPassword.isPending}
              data-testid="button-send-reset"
            >
              {forgotPassword.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Send reset link
            </Button>

            <a href="/login">
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full font-semibold text-muted-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </Button>
            </a>
          </form>
        )}

        <p className="text-center text-xs font-medium text-muted-foreground">
          A private catalogue for two.
        </p>
      </div>
    </div>
  );
}
