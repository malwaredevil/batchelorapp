import React, { createContext, useContext, useEffect } from "react";
import { useGetCurrentUser } from "@workspace/api-client-react";
import type { AuthUser } from "@workspace/api-client-react";

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  error: unknown;
}

const AuthContext = createContext<AuthContextType>({ user: null, isLoading: true, error: null });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, error } = useGetCurrentUser();

  return (
    <AuthContext.Provider value={{ user: user ?? null, isLoading, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// All apps share one login experience hosted by the main Batchelor app at
// the domain root. Sub-apps (pottery, quilting, travels) never render their
// own login page — when unauthenticated, they hard-navigate here instead of
// using client-side routing, since "/login" lives in a different SPA bundle
// than the sub-app's own (e.g. "/travels"). `returnTo` carries the user's
// original destination (including the sub-app's base path) so the root
// login page can send them back after a successful sign-in.
function redirectToMainLogin() {
  const returnTo = window.location.pathname + window.location.search;
  window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) {
      redirectToMainLogin();
    }
  }, [user, isLoading]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse w-8 h-8 rounded-full bg-primary/20"></div>
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
