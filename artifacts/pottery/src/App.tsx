import { useEffect } from "react";
import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth, redirectToMainLogin } from "@/lib/auth";
import { ThemeProvider } from "@/hooks/use-theme";
import { AppShell } from "@/components/app-shell";
import { ElainePageContextProvider, ElaineWidget } from "@workspace/elaine-ui";
import "@/features";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Collection from "@/pages/collection";
import AddPiece from "@/pages/add";
import PieceDetail from "@/pages/detail";
import Compare from "@/pages/compare";
import Categories from "@/pages/categories";
import Maintenance from "@/pages/maintenance";
import Settings from "@/pages/settings";
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
        <Route path="/add" component={AddPiece} />
        <Route path="/compare" component={Compare} />
        <Route path="/piece/:id" component={PieceDetail} />
        <Route path="/categories" component={Categories} />
        <Route path="/maintenance" component={Maintenance} />
        <Route path="/settings" component={Settings} />
        <Route path="/login">
          <Redirect to="/" />
        </Route>
        <Route component={NotFound} />
      </Switch>
      <ElaineWidget appId="pottery" />
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
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
