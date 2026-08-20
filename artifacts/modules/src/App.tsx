import { lazy, Suspense, useEffect, type ReactNode } from "react";
import * as Sentry from "@sentry/react";
import {
  Switch,
  Route,
  Router as WouterRouter,
  Redirect,
  useLocation,
} from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemePreferenceSync } from "@workspace/app-shell";
import {
  AuthProvider,
  useAuth,
  redirectToMainLogin,
} from "@workspace/web-core/auth";
import { crossAppUrl } from "@workspace/web-core/cross-app";
import { ModuleShell } from "@/components/module-shell";
import { BackgroundTaskProvider } from "@/lib/background-tasks";
import {
  ThemeProvider,
  ElainePageContextProvider,
  CommandPalette,
  ElaineWidget,
} from "@workspace/elaine-ui";
import { type ElaineAppId } from "@workspace/api-client-react";
import "@/features";
import "@/pottery/features";
import "@/quilting/features";
import "@/ornaments/features";
import "@/travels/features";
import "@/office/features";
// scaffold:anchor:feature-imports — scaffold-collection-module inserts feature imports below; do not remove

import { MessengerNotification } from "@workspace/messenger-ui";
import { BulkAddProvider } from "@/quilting/contexts/bulk-add-context";
import { Layout as TravelsLayout } from "@/travels/components/Layout";
import { OfficeLayout } from "@/office/components/OfficeLayout";

// ---------------------------------------------------------------------------
// Route-level page components — all lazy so Vite splits them into separate
// chunks. A user opening only Pottery never downloads the Quilting or Travels
// bundles. Each module (pottery/quilting/ornaments/travels/office) becomes its
// own async boundary resolved on first navigation to that section.
// ---------------------------------------------------------------------------

// Pottery
const PotteryCollection = lazy(() => import("@/pottery/pages/collection"));
const PotteryAdd = lazy(() => import("@/pottery/pages/add"));
const PotteryCompare = lazy(() => import("@/pottery/pages/compare"));
const PotteryScan = lazy(() => import("@/pottery/pages/scan"));
const PotteryStats = lazy(() => import("@/pottery/pages/stats"));
const PotteryDetail = lazy(() => import("@/pottery/pages/detail"));
const PotteryCategories = lazy(() => import("@/pottery/pages/categories"));
const PotteryMaintenance = lazy(() => import("@/pottery/pages/maintenance"));
const PotteryWatchlist = lazy(() => import("@/pottery/pages/watchlist"));

// Quilting
const Fabrics = lazy(() => import("@/quilting/pages/fabrics/index"));
const AddFabric = lazy(() => import("@/quilting/pages/fabrics/add"));
const BulkAddFabric = lazy(() => import("@/quilting/pages/fabrics/bulk-add"));
const FabricDetail = lazy(() => import("@/quilting/pages/fabrics/detail"));
const Patterns = lazy(() => import("@/quilting/pages/patterns/index"));
const AddPattern = lazy(() => import("@/quilting/pages/patterns/add"));
const PatternDetail = lazy(() => import("@/quilting/pages/patterns/detail"));
const Quilts = lazy(() => import("@/quilting/pages/quilts/index"));
const AddQuilt = lazy(() => import("@/quilting/pages/quilts/add"));
const QuiltDetail = lazy(() => import("@/quilting/pages/quilts/detail"));
const QuiltingCompare = lazy(() => import("@/quilting/pages/compare"));
const Blocks = lazy(() => import("@/quilting/pages/blocks/index"));
const BlockDesigner = lazy(() => import("@/quilting/pages/blocks/designer"));
const CutPatternPage = lazy(
  () => import("@/quilting/pages/blocks/cut-pattern"),
);
const BlockDetail = lazy(() => import("@/quilting/pages/blocks/detail"));
const BlockLibrary = lazy(() => import("@/quilting/pages/library/blocks"));
const Layouts = lazy(() => import("@/quilting/pages/layouts/index"));
const LayoutComposer = lazy(() => import("@/quilting/pages/layouts/composer"));
const LayoutDetail = lazy(() => import("@/quilting/pages/layouts/detail"));
const WholeQuiltList = lazy(
  () => import("@/quilting/pages/blocks/whole-quilt-list"),
);
const WholeQuiltDesigner = lazy(
  () => import("@/quilting/pages/blocks/whole-quilt"),
);
const Shopping = lazy(() => import("@/quilting/pages/shopping/index"));
const YardageCalculator = lazy(() => import("@/quilting/pages/tools/yardage"));
const QuiltingCategories = lazy(() => import("@/quilting/pages/categories"));
const QuiltingMaintenance = lazy(() => import("@/quilting/pages/maintenance"));

// Quilting dev tools (only rendered in DEV; tree-shaken from prod bundle)
const FabricCompareDevPage = lazy(
  () => import("@/quilting/pages/dev/fabric-compare"),
);
const FabricDensityDevPage = lazy(
  () => import("@/quilting/pages/dev/fabric-density"),
);
const FabricSizeDevPage = lazy(
  () => import("@/quilting/pages/dev/fabric-size"),
);
const FabricPipelineDevPage = lazy(
  () => import("@/quilting/pages/dev/fabric-pipeline"),
);
const FabricPhotoPreviewDevPage = lazy(
  () => import("@/quilting/pages/dev/fabric-photo-preview"),
);

// Barcode lookup (hub-level, not app-specific)
const BarcodeLookupPage = lazy(() => import("@/pages/barcode-lookup"));

// scaffold:anchor:lazy-pages — scaffold-collection-module inserts lazy page imports below; do not remove

// Ornaments
const OrnamentsCollection = lazy(() => import("@/ornaments/pages/collection"));
const OrnamentsAdd = lazy(() => import("@/ornaments/pages/add"));
const OrnamentsCameraAdd = lazy(() => import("@/ornaments/pages/camera-add"));
const OrnamentsScan = lazy(() => import("@/ornaments/pages/scan"));
const OrnamentsStats = lazy(() => import("@/ornaments/pages/stats"));
const OrnamentsDetail = lazy(() => import("@/ornaments/pages/detail"));
const OrnamentsCategories = lazy(() => import("@/ornaments/pages/categories"));
const OrnamentsMaintenance = lazy(
  () => import("@/ornaments/pages/maintenance"),
);
const OrnamentsHallmarkEvents = lazy(
  () => import("@/ornaments/pages/hallmark-events"),
);

// Travels
const TravelsDashboard = lazy(() => import("@/travels/pages/Dashboard"));
const TravelsTrips = lazy(() => import("@/travels/pages/Trips"));
const TravelsTripDetail = lazy(() => import("@/travels/pages/TripDetail"));
const TravelsWorldMap = lazy(() => import("@/travels/pages/WorldMap"));
const TravelsExplore = lazy(() => import("@/travels/pages/Explore"));
const TravelsWishlist = lazy(() => import("@/travels/pages/Wishlist"));
const TravelsDestinations = lazy(() => import("@/travels/pages/Destinations"));
const TravelsTravelCalendar = lazy(
  () => import("@/travels/pages/TravelCalendar"),
);
const TravelsGmailReview = lazy(() => import("@/travels/pages/GmailReview"));
const TravelsDocuments = lazy(() => import("@/travels/pages/Documents"));
const TravelsPrivacyPolicy = lazy(
  () => import("@/travels/pages/PrivacyPolicy"),
);
const TravelsTripShare = lazy(() => import("@/travels/pages/TripShare"));

// Office
const MessengerPage = lazy(() => import("@/office/pages/messenger"));
const OfficeGmail = lazy(() => import("@/office/pages/gmail"));
const OfficeCalendar = lazy(() => import("@/office/pages/calendar"));
const OfficeNotes = lazy(() => import("@/office/pages/notes"));
const OfficeReminders = lazy(() => import("@/office/pages/reminders"));

// Shared
const NotFound = lazy(() => import("@/pages/not-found"));

// ---------------------------------------------------------------------------

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

function Home() {
  useEffect(() => {
    window.location.href = crossAppUrl("/");
  }, []);
  return <Splash />;
}

function deriveAppId(path: string): ElaineAppId {
  if (path.startsWith("/pottery")) return "pottery";
  if (path.startsWith("/quilting")) return "quilting";
  if (path.startsWith("/ornaments")) return "ornaments";
  if (path.startsWith("/travels")) return "travels";
  return "hub";
}

function GlobalElaineWidget() {
  const [path] = useLocation();
  return (
    <ElaineWidget
      appId={deriveAppId(path)}
      fullScreenPath="/elaine/"
      currentPath={path}
    />
  );
}

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
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
      <ScrollToTop />
      <ThemePreferenceSync />
      <BackgroundTaskProvider>
        <ModuleShell>
          <BulkAddProvider>
            <Suspense fallback={<Splash />}>
              <Switch>
                <Route path="/" component={Home} />
                <Route path="/barcode-lookup" component={BarcodeLookupPage} />
                <Route path="/pottery" component={PotteryCollection} />
                <Route path="/pottery/add" component={PotteryAdd} />
                <Route path="/pottery/compare" component={PotteryCompare} />
                <Route path="/pottery/scan" component={PotteryScan} />
                <Route path="/pottery/stats" component={PotteryStats} />
                <Route path="/pottery/piece/:id" component={PotteryDetail} />
                <Route
                  path="/pottery/categories"
                  component={PotteryCategories}
                />
                <Route
                  path="/pottery/maintenance"
                  component={PotteryMaintenance}
                />
                <Route path="/pottery/watchlist" component={PotteryWatchlist} />
                <Route path="/quilting" component={Fabrics} />
                <Route path="/quilting/fabrics" component={Fabrics} />
                <Route path="/quilting/fabrics/add" component={AddFabric} />
                <Route
                  path="/quilting/fabrics/bulk-add"
                  component={BulkAddFabric}
                />
                <Route path="/quilting/fabrics/:id" component={FabricDetail} />
                <Route path="/quilting/patterns" component={Patterns} />
                <Route path="/quilting/patterns/add" component={AddPattern} />
                <Route
                  path="/quilting/patterns/:id"
                  component={PatternDetail}
                />
                <Route path="/quilting/quilts" component={Quilts} />
                <Route path="/quilting/quilts/add" component={AddQuilt} />
                <Route path="/quilting/quilts/:id" component={QuiltDetail} />
                <Route path="/quilting/compare" component={QuiltingCompare} />
                <Route path="/quilting/blocks" component={Blocks} />
                <Route path="/quilting/blocks/new" component={BlockDesigner} />
                <Route
                  path="/quilting/blocks/:id/cut-pattern"
                  component={CutPatternPage}
                />
                <Route
                  path="/quilting/blocks/:id/edit"
                  component={BlockDesigner}
                />
                <Route path="/quilting/blocks/:id" component={BlockDetail} />
                <Route
                  path="/quilting/library/blocks"
                  component={BlockLibrary}
                />
                <Route
                  path="/quilting/library/blocks/new"
                  component={BlockDesigner}
                />
                <Route
                  path="/quilting/library/blocks/:id/edit"
                  component={BlockDesigner}
                />
                <Route path="/quilting/layouts" component={Layouts} />
                <Route
                  path="/quilting/layouts/new"
                  component={LayoutComposer}
                />
                <Route
                  path="/quilting/layouts/:id/edit"
                  component={LayoutComposer}
                />
                <Route path="/quilting/layouts/:id" component={LayoutDetail} />
                <Route
                  path="/quilting/whole-quilt"
                  component={WholeQuiltList}
                />
                <Route
                  path="/quilting/whole-quilt/designer"
                  component={WholeQuiltDesigner}
                />
                <Route path="/quilting/shopping" component={Shopping} />
                <Route
                  path="/quilting/tools/yardage"
                  component={YardageCalculator}
                />
                <Route
                  path="/quilting/categories"
                  component={QuiltingCategories}
                />
                <Route
                  path="/quilting/maintenance"
                  component={QuiltingMaintenance}
                />
                {import.meta.env.DEV && (
                  <>
                    <Route
                      path="/quilting/dev/fabric-compare"
                      component={FabricCompareDevPage}
                    />
                    <Route
                      path="/quilting/dev/fabric-density"
                      component={FabricDensityDevPage}
                    />
                    <Route
                      path="/quilting/dev/fabric-size"
                      component={FabricSizeDevPage}
                    />
                    <Route
                      path="/quilting/dev/fabric-pipeline"
                      component={FabricPipelineDevPage}
                    />
                    <Route
                      path="/quilting/dev/fabric-photo-preview"
                      component={FabricPhotoPreviewDevPage}
                    />
                  </>
                )}
                <Route path="/travels">
                  <TravelsLayout>
                    <TravelsDashboard />
                  </TravelsLayout>
                </Route>
                <Route path="/travels/trips">
                  <TravelsLayout>
                    <TravelsTrips />
                  </TravelsLayout>
                </Route>
                <Route path="/travels/trips/:id">
                  {(params) => (
                    <TravelsLayout>
                      <TravelsTripDetail id={Number(params.id)} />
                    </TravelsLayout>
                  )}
                </Route>
                <Route path="/travels/map">
                  <TravelsLayout>
                    <TravelsWorldMap />
                  </TravelsLayout>
                </Route>
                <Route path="/travels/explore">
                  <TravelsLayout>
                    <TravelsExplore />
                  </TravelsLayout>
                </Route>
                <Route path="/travels/wishlist">
                  <TravelsLayout>
                    <TravelsWishlist />
                  </TravelsLayout>
                </Route>
                <Route path="/travels/destinations">
                  <TravelsLayout>
                    <TravelsDestinations />
                  </TravelsLayout>
                </Route>
                <Route path="/travels/travel-calendar">
                  <TravelsLayout>
                    <TravelsTravelCalendar />
                  </TravelsLayout>
                </Route>
                <Route path="/travels/gmail">
                  <TravelsLayout>
                    <TravelsGmailReview />
                  </TravelsLayout>
                </Route>
                <Route path="/travels/documents">
                  <TravelsLayout>
                    <TravelsDocuments />
                  </TravelsLayout>
                </Route>
                <Route path="/ornaments" component={OrnamentsCollection} />
                <Route path="/ornaments/add" component={OrnamentsAdd} />
                <Route
                  path="/ornaments/camera-add"
                  component={OrnamentsCameraAdd}
                />
                <Route path="/ornaments/scan" component={OrnamentsScan} />
                <Route path="/ornaments/stats" component={OrnamentsStats} />
                <Route
                  path="/ornaments/categories"
                  component={OrnamentsCategories}
                />
                <Route
                  path="/ornaments/maintenance"
                  component={OrnamentsMaintenance}
                />
                <Route
                  path="/ornaments/hallmark-events"
                  component={OrnamentsHallmarkEvents}
                />
                <Route
                  path="/ornaments/ornament/:id"
                  component={OrnamentsDetail}
                />
                {/* scaffold:anchor:module-routes — scaffold-collection-module inserts routes below; do not remove */}

                <Route path="/office">
                  <Redirect to="/office/gmail" />
                </Route>
                <Route path="/office/gmail">
                  <OfficeLayout>
                    <OfficeGmail />
                  </OfficeLayout>
                </Route>
                <Route path="/office/calendar">
                  <OfficeLayout>
                    <OfficeCalendar />
                  </OfficeLayout>
                </Route>
                <Route path="/office/notes">
                  <OfficeLayout>
                    <OfficeNotes />
                  </OfficeLayout>
                </Route>
                <Route path="/office/reminders">
                  <OfficeLayout>
                    <OfficeReminders />
                  </OfficeLayout>
                </Route>
                <Route path="/office/messenger" component={MessengerPage} />
                <Route component={NotFound} />
              </Switch>
            </Suspense>
          </BulkAddProvider>
        </ModuleShell>
      </BackgroundTaskProvider>
      <MessengerNotification />
      <GlobalElaineWidget />
    </>
  );
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/travels/trips/:id/share">
        <PublicRouteBoundary>
          <Suspense fallback={<Splash />}>
            <TravelsTripShare />
          </Suspense>
        </PublicRouteBoundary>
      </Route>
      <Route path="/travels/privacy">
        <PublicRouteBoundary>
          <Suspense fallback={<Splash />}>
            <TravelsPrivacyPolicy />
          </Suspense>
        </PublicRouteBoundary>
      </Route>
      <Route>
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
      </Route>
    </Switch>
  );
}

function PublicRouteBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary
      fallback={
        <div className="p-8 text-center text-muted-foreground">
          Something went wrong.
        </div>
      }
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AppRoutes />
          </WouterRouter>
          <Toaster />
          <CommandPalette />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
