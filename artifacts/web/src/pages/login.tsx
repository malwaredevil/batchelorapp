import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useLogin,
  useGetAuthProviders,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { AppLogo } from "@/components/app-logo";

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-0.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

// Only ever accept a same-origin relative path for post-login redirect —
// never an absolute URL or protocol-relative "//host" path — to prevent this
// being used as an open redirect.
function sanitizeReturnTo(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export default function Login() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const { data: providers } = useGetAuthProviders();
  const returnTo = sanitizeReturnTo(
    new URLSearchParams(window.location.search).get("returnTo"),
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (!error) return;
    const messages: Record<string, string> = {
      google_not_allowed:
        "That Google account isn't part of the collection yet.",
      google_unavailable: "Google sign-in isn't set up yet.",
      google_failed: "Couldn't sign you in with Google. Please try again.",
    };
    toast.error(messages[error] ?? "Couldn't sign you in. Please try again.");
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const login = useLogin({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: getGetCurrentUserQueryKey(),
        });
        if (returnTo) {
          // returnTo may point into a different sub-app (pottery/quilting/
          // travels), which is a separate SPA bundle from this login page —
          // a client-side wouter navigation can't cross that boundary, so
          // always do a full page load here.
          window.location.href = returnTo;
        } else {
          navigate("/");
        }
      },
      onError: () => {
        toast.error("Incorrect email or password.");
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    login.mutate({ data: { email: email.trim(), password, rememberMe } });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-3 text-center">
          <AppLogo className="mx-auto h-16 w-16 drop-shadow-sm" />
          <h1 className="text-2xl font-bold tracking-tight">Batchelor</h1>
          <p className="text-sm text-muted-foreground">
            John and Ashley's Collections
          </p>
        </div>

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

          <div className="space-y-2">
            <Label
              htmlFor="password"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-11 bg-muted/60"
              data-testid="input-password"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                id="remember-me"
                type="checkbox"
                className="h-4 w-4 cursor-pointer rounded border-card-border accent-primary"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                data-testid="checkbox-remember-me"
              />
              <label
                htmlFor="remember-me"
                className="cursor-pointer select-none text-sm text-muted-foreground"
              >
                Stay signed in for 30 days
              </label>
            </div>
            <Link
              href="/forgot-password"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Forgot password?
            </Link>
          </div>

          <Button
            type="submit"
            className="h-11 w-full font-semibold"
            disabled={login.isPending}
            data-testid="button-login"
          >
            {login.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign in
          </Button>

          {providers?.google && (
            <>
              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-card-border" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-card px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    or
                  </span>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full gap-2 font-semibold"
                onClick={() => {
                  window.location.href = returnTo
                    ? `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`
                    : "/api/auth/google";
                }}
                data-testid="button-google"
              >
                <GoogleIcon className="h-4 w-4" />
                Continue with Google
              </Button>
            </>
          )}
        </form>

        <p className="text-center text-xs font-medium text-muted-foreground">
          One account, every collection.
        </p>
      </div>
    </div>
  );
}
