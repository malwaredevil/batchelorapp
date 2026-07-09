import { useEffect } from "react";
import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth, redirectToMainLogin } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import {
  ThemeProvider,
  ElainePageContextProvider,
  ElaineWidget,
  CommandPalette,
} from "@workspace/elaine-ui";
import "@/features";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Collection from "@/pages/collection";
import AddOrnament from "@/pages/add";
import OrnamentDetail from "@/pages/detail";
import Scan from "@/pages/scan";
import Categories from "@/pages/categories";
import Maintenance from "@/pages/maintenance";
import Settings from "@/pages/settings";
import StatsPage from "@/pages/stats";
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
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function Routes() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) redirectToMainLogin();
  }, [isLoading, user]);

  if (isLoading) return <Splash />;

  if (!user) {
    return (
      <Switch>
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route>
          <Splash />
        </Route>
      </Switch>
    );
  }

  return (
    <AppShell>
      <Switch>
        <Route path="/" component={Collection} />
        <Route path="/add" component={AddOrnament} />
        <Route path="/scan" component={Scan} />
        <Route path="/stats" component={StatsPage} />
        <Route path="/ornament/:id" component={OrnamentDetail} />
        <Route path="/categories" component={Categories} />
        <Route path="/maintenance" component={Maintenance} />
        <Route path="/settings" component={Settings} />
        <Route path="/login">
          <Redirect to="/" />
        </Route>
        <Route component={NotFound} />
      </Switch>
      <ElaineWidget appId="ornaments" fullScreenPath="/elaine/" />
    </AppShell>
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
                <Routes />
              </ElainePageContextProvider>
            </AuthProvider>
          </WouterRouter>
          <Toaster />
          <CommandPalette />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
