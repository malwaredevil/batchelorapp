import { useEffect } from "react";
import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth, redirectToMainLogin } from "@/lib/auth";
import { NavGuardProvider } from "@/lib/nav-guard";
import { AppShell } from "@/components/app-shell";
import { BulkAddProvider } from "@/contexts/bulk-add-context";
import {
  ThemeProvider,
  ElainePageContextProvider,
  ElaineWidget,
  CommandPalette,
} from "@workspace/elaine-ui";

// Register all features before the shell renders
import "@/features/index";

import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Fabrics from "@/pages/fabrics";
import AddFabric from "@/pages/fabrics/add";
import BulkAddFabric from "@/pages/fabrics/bulk-add";
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
import BlockDetail from "@/pages/blocks/detail";
import CutPatternPage from "@/pages/blocks/cut-pattern";
import BlockLibrary from "@/pages/library/blocks";
import Layouts from "@/pages/layouts";
import LayoutComposer from "@/pages/layouts/composer";
import LayoutDetail from "@/pages/layouts/detail";
import WholeQuiltDesigner from "@/pages/blocks/whole-quilt";
import WholeQuiltList from "@/pages/blocks/whole-quilt-list";
import Shopping from "@/pages/shopping";
import Maintenance from "@/pages/maintenance";
import NotFound from "@/pages/not-found";
import YardageCalculator from "@/pages/tools/yardage";

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
        <Route path="/">
          <Redirect to="/fabrics" />
        </Route>
        {/* Fabrics */}
        <Route path="/fabrics" component={Fabrics} />
        <Route path="/fabrics/add" component={AddFabric} />
        <Route path="/fabrics/bulk-add" component={BulkAddFabric} />
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
        <Route path="/blocks/:id/edit" component={BlockDesigner} />
        <Route path="/blocks/:id" component={BlockDetail} />
        {/* Block Patterns (reusable block templates) */}
        <Route path="/library/blocks" component={BlockLibrary} />
        <Route path="/library/blocks/new" component={BlockDesigner} />
        <Route path="/library/blocks/:id/edit" component={BlockDesigner} />
        <Route path="/layouts" component={Layouts} />
        <Route path="/layouts/new" component={LayoutComposer} />
        <Route path="/layouts/:id/edit" component={LayoutComposer} />
        <Route path="/layouts/:id" component={LayoutDetail} />
        <Route path="/whole-quilt" component={WholeQuiltList} />
        <Route path="/whole-quilt/designer" component={WholeQuiltDesigner} />
        <Route path="/shopping" component={Shopping} />
        {/* Tools */}
        <Route path="/tools/yardage" component={YardageCalculator} />
        {/* Settings */}
        <Route path="/categories" component={Categories} />
        <Route path="/maintenance" component={Maintenance} />
        {/* Auth */}
        <Route path="/login">
          <Redirect to="/fabrics" />
        </Route>
        <Route component={NotFound} />
      </Switch>
      <ElaineWidget appId="quilting" fullScreenPath="/elaine/" />
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <BulkAddProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <NavGuardProvider>
                <AuthProvider>
                  <ElainePageContextProvider>
                    <Routes />
                  </ElainePageContextProvider>
                </AuthProvider>
              </NavGuardProvider>
            </WouterRouter>
            <Toaster />
            <CommandPalette />
          </BulkAddProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
