import { useEffect } from "react";
import * as Sentry from "@sentry/react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth, redirectToMainLogin } from "@/lib/auth";
import { AuthProvider as WebCoreAuthProvider } from "@workspace/web-core/auth";
import { MessengerNotification } from "@workspace/messenger-ui";
import {
  ElainePageContextProvider,
  ThemeProvider,
  useTheme,
  CommandPalette,
} from "@workspace/elaine-ui";
import { Header } from "@/components/Header";
import { InstallBanner } from "@workspace/web-core";
import "@/features";
import Chat from "@/pages/Chat";
import Memory from "@/pages/Memory";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

// Applies the user's saved theme preference once they're loaded, so the
// choice follows the account across every sub-app (light remains default).
// Mirrors the Hub's ThemeSync so Elaine never feels like a separate product.
function ThemeSync() {
  const { user } = useAuth();
  const { setTheme } = useTheme();
  useEffect(() => {
    const pref = user?.themePreference;
    if (pref === "light" || pref === "dark") setTheme(pref);
  }, [user?.themePreference, setTheme]);
  return null;
}

function Routes() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) redirectToMainLogin();
  }, [isLoading, user]);

  useEffect(() => {
    if (user) {
      Sentry.setUser({ id: String(user.id), email: user.email });
    } else {
      Sentry.setUser(null);
    }
  }, [user]);

  if (isLoading || !user) return <Splash />;

  return (
    <>
      <div className="min-h-screen bg-background">
        <ThemeSync />
        <Header />
        <InstallBanner />
        <main>
          <Switch>
            <Route path="/" component={Chat} />
            <Route path="/memory" component={Memory} />
            <Route component={NotFound} />
          </Switch>
        </main>
      </div>
      <MessengerNotification />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <WebCoreAuthProvider>
                <ElainePageContextProvider>
                  <Sentry.ErrorBoundary
                    fallback={
                      <div className="flex min-h-screen items-center justify-center bg-background">
                        <div className="text-center space-y-3">
                          <p className="text-muted-foreground">
                            Something went wrong.
                          </p>
                          <button
                            onClick={() => window.location.reload()}
                            className="text-sm text-primary underline"
                          >
                            Reload page
                          </button>
                        </div>
                      </div>
                    }
                  >
                    <Routes />
                  </Sentry.ErrorBoundary>
                </ElainePageContextProvider>
              </WebCoreAuthProvider>
            </AuthProvider>
          </WouterRouter>
          <Toaster richColors position="top-right" />
          <CommandPalette />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
