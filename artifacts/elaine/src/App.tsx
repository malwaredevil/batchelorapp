import { useEffect } from "react";
import * as Sentry from "@sentry/react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth, redirectToMainLogin } from "@/lib/auth";
import { ThemePreferenceSync } from "@workspace/app-shell";
import { MessengerNotification } from "@workspace/messenger-ui";
import {
  ElainePageContextProvider,
  ThemeProvider,
  CommandPalette,
} from "@workspace/elaine-ui";
import { Header } from "@/components/Header";
import { InstallBanner } from "@workspace/web-core";
import "@/features";
import Chat from "@/pages/Chat";
import Memory from "@/pages/Memory";
import Tasks from "@/pages/Tasks";
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

function Routes() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) redirectToMainLogin();
  }, [isLoading, user]);

  useEffect(() => {
    if (user) {
      Sentry.setUser({ id: String(user.id) });
    } else {
      Sentry.setUser(null);
    }
  }, [user]);

  if (isLoading || !user) return <Splash />;

  return (
    <>
      {/* h-dvh + flex-col so the main area always fills exactly the space
          below the header without any page-level scrollbar. Chat uses
          h-full inside main; Memory/Tasks scroll within the main overflow. */}
      <div className="flex h-dvh flex-col bg-background">
        <ThemePreferenceSync />
        <Header />
        <InstallBanner />
        {/* mx-auto max-w-6xl matches the ApplicationHeader container so page
            content aligns with the header edges like every other app page. */}
        <main className="mx-auto w-full max-w-6xl flex-1 min-h-0 overflow-auto px-4">
          <Switch>
            <Route path="/" component={Chat} />
            <Route path="/memory" component={Memory} />
            <Route path="/tasks" component={Tasks} />
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
