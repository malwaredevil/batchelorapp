import React, { createContext, useContext, useEffect } from "react";
import { useGetCurrentUser } from "@workspace/api-client-react";
import type { AuthUser } from "@workspace/api-client-react";
import { useLocation } from "wouter";

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

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    }
  }, [user, isLoading, setLocation]);

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
