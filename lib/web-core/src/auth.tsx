import { createContext, useContext, type ReactNode } from "react";
import { useGetCurrentUser } from "@workspace/api-client-react";
import type { AuthUser } from "@workspace/api-client-react";

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useGetCurrentUser();

  return (
    <AuthContext.Provider value={{ user: data ?? null, isLoading }}>
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
// than the sub-app's own (e.g. "/pottery"). `returnTo` carries the user's
// original destination (including the sub-app's base path) so the root
// login page can send them back after a successful sign-in.
export function redirectToMainLogin() {
  const returnTo = window.location.pathname + window.location.search;
  window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
}
