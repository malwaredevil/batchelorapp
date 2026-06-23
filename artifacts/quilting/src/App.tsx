import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { NavGuardProvider } from "@/lib/nav-guard";
import { AppShell } from "@/components/app-shell";

// Register all features before the shell renders
import "@/features/index";

import Login from "@/pages/login";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Fabrics from "@/pages/fabrics";
import AddFabric from "@/pages/fabrics/add";
import FabricDetail from "@/pages/fabrics/detail";
import Patterns from "@/pages/patterns";
import AddPattern from "@/pages/patterns/add";
import PatternDetail from "@/pages/patterns/detail";
import Quilts from "@/pages/quilts";
import AddQuilt from "@/pages/quilts/add";
import QuiltDetail from "@/pages/quilts/detail";
import Compare from "@/pages/compare";
import Categories from "@/pages/categories";
import Blocks from "@/pages/blocks";
import BlockDesigner from "@/pages/blocks/designer";
import CutPatternPage from "@/pages/blocks/cut-pattern";
import Layouts from "@/pages/layouts";
import LayoutComposer from "@/pages/layouts/composer";
import WholeQuiltDesigner from "@/pages/blocks/whole-quilt";
import WholeQuiltList from "@/pages/blocks/whole-quilt-list";
import Shopping from "@/pages/shopping";
import Maintenance from "@/pages/maintenance";
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
    <AppShell>
      <Switch>
        <Route path="/">
          <Redirect to="/fabrics" />
        </Route>
        {/* Fabrics */}
        <Route path="/fabrics" component={Fabrics} />
        <Route path="/fabrics/add" component={AddFabric} />
        <Route path="/fabrics/:id" component={FabricDetail} />
        {/* Patterns */}
        <Route path="/patterns" component={Patterns} />
        <Route path="/patterns/add" component={AddPattern} />
        <Route path="/patterns/:id" component={PatternDetail} />
        {/* Finished Quilts */}
        <Route path="/quilts" component={Quilts} />
        <Route path="/quilts/add" component={AddQuilt} />
        <Route path="/quilts/:id" component={QuiltDetail} />
        {/* Tools */}
        <Route path="/compare" component={Compare} />
        {/* Block Designer */}
        <Route path="/blocks" component={Blocks} />
        <Route path="/blocks/new" component={BlockDesigner} />
        <Route path="/blocks/:id/cut-pattern" component={CutPatternPage} />
        <Route path="/blocks/:id" component={BlockDesigner} />
        <Route path="/layouts" component={Layouts} />
        <Route path="/layouts/new" component={LayoutComposer} />
        <Route path="/layouts/:id" component={LayoutComposer} />
        <Route path="/whole-quilt" component={WholeQuiltList} />
        <Route path="/whole-quilt/designer" component={WholeQuiltDesigner} />
        <Route path="/shopping" component={Shopping} />
        {/* Settings */}
        <Route path="/categories" component={Categories} />
        <Route path="/maintenance" component={Maintenance} />
        {/* Auth */}
        <Route path="/login">
          <Redirect to="/fabrics" />
        </Route>
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <NavGuardProvider>
            <AuthProvider>
              <Routes />
            </AuthProvider>
          </NavGuardProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
