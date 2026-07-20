import { useEffect } from "react";
import * as Sentry from "@sentry/react";
import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AuthProvider as WebCoreAuthProvider } from "@workspace/web-core/auth";
import { AppLauncher } from "@/components/AppLauncher";
import {
  ThemeProvider,
  useTheme,
  ElainePageContextProvider,
  ElaineWidget,
} from "@workspace/elaine-ui";
import { MessengerNotification } from "@workspace/messenger-ui";
import Login from "@/pages/login";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Account from "@/pages/account";
import OwnerPanel from "@/pages/owner-panel";
import ControlPanel from "@/pages/control-panel";
import GoogleApisDemo from "@/pages/google-apis-demo";
import NotFound from "@/pages/not-found";
import { BirthdayBanner } from "@/components/BirthdayBanner";

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

// Applies the user's saved theme preference once they're loaded, so the choice
// follows the account across devices (light remains the default).
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
    if (user) {
      Sentry.setUser({ id: String(user.id), email: user.email });
    } else {
      Sentry.setUser(null);
    }
  }, [user]);

  if (isLoading) return <Splash />;

  if (!user) {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route>
          <Redirect to="/login" />
        </Route>
      </Switch>
    );
  }

  return (
    <>
      <ThemeSync />
      <BirthdayBanner />
      <Switch>
        <Route path="/" component={AppLauncher} />
        <Route path="/account" component={Account} />
        <Route path="/owner-panel" component={OwnerPanel} />
        <Route path="/control-panel" component={ControlPanel} />
        <Route path="/google-apis-demo" component={GoogleApisDemo} />
        <Route path="/login">
          <Redirect to="/" />
        </Route>
        <Route component={NotFound} />
      </Switch>
      <ElaineWidget appId="hub" fullScreenPath="/elaine/" />
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
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
