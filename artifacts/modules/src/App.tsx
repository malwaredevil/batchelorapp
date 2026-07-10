import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AuthProvider,
  useAuth,
  redirectToMainLogin,
} from "@workspace/web-core/auth";
import { useRealtimeInvalidation } from "@workspace/api-client-react";
import { ModuleShell } from "@/components/module-shell";
import {
  ThemeProvider,
  ElainePageContextProvider,
  CommandPalette,
} from "@workspace/elaine-ui";
import "@/features";
import "@/pottery/features";
import "@/quilting/features";
import "@/ornaments/features";
import "@/travels/features";
import "@/office/features";
import NotFound from "@/pages/not-found";
import PotteryCollection from "@/pottery/pages/collection";
import PotteryAdd from "@/pottery/pages/add";
import PotteryCompare from "@/pottery/pages/compare";
import PotteryScan from "@/pottery/pages/scan";
import PotteryStats from "@/pottery/pages/stats";
import PotteryDetail from "@/pottery/pages/detail";
import PotteryCategories from "@/pottery/pages/categories";
import PotteryMaintenance from "@/pottery/pages/maintenance";
import { BulkAddProvider } from "@/quilting/contexts/bulk-add-context";
import Fabrics from "@/quilting/pages/fabrics/index";
import AddFabric from "@/quilting/pages/fabrics/add";
import BulkAddFabric from "@/quilting/pages/fabrics/bulk-add";
import FabricDetail from "@/quilting/pages/fabrics/detail";
import Patterns from "@/quilting/pages/patterns/index";
import AddPattern from "@/quilting/pages/patterns/add";
import PatternDetail from "@/quilting/pages/patterns/detail";
import Quilts from "@/quilting/pages/quilts/index";
import AddQuilt from "@/quilting/pages/quilts/add";
import QuiltDetail from "@/quilting/pages/quilts/detail";
import QuiltingCompare from "@/quilting/pages/compare";
import Blocks from "@/quilting/pages/blocks/index";
import BlockDesigner from "@/quilting/pages/blocks/designer";
import CutPatternPage from "@/quilting/pages/blocks/cut-pattern";
import BlockDetail from "@/quilting/pages/blocks/detail";
import BlockLibrary from "@/quilting/pages/library/blocks";
import Layouts from "@/quilting/pages/layouts/index";
import LayoutComposer from "@/quilting/pages/layouts/composer";
import LayoutDetail from "@/quilting/pages/layouts/detail";
import WholeQuiltList from "@/quilting/pages/blocks/whole-quilt-list";
import WholeQuiltDesigner from "@/quilting/pages/blocks/whole-quilt";
import Shopping from "@/quilting/pages/shopping/index";
import YardageCalculator from "@/quilting/pages/tools/yardage";
import QuiltingCategories from "@/quilting/pages/categories";
import QuiltingMaintenance from "@/quilting/pages/maintenance";
import FabricCompareDevPage from "@/quilting/pages/dev/fabric-compare";
import OrnamentsCollection from "@/ornaments/pages/collection";
import OrnamentsAdd from "@/ornaments/pages/add";
import OrnamentsScan from "@/ornaments/pages/scan";
import OrnamentsStats from "@/ornaments/pages/stats";
import OrnamentsDetail from "@/ornaments/pages/detail";
import OrnamentsCategories from "@/ornaments/pages/categories";
import OrnamentsMaintenance from "@/ornaments/pages/maintenance";
import OrnamentsHallmarkEvents from "@/ornaments/pages/hallmark-events";
import { Layout as TravelsLayout } from "@/travels/components/Layout";
import TravelsDashboard from "@/travels/pages/Dashboard";
import TravelsTrips from "@/travels/pages/Trips";
import TravelsTripDetail from "@/travels/pages/TripDetail";
import TravelsWorldMap from "@/travels/pages/WorldMap";
import TravelsExplore from "@/travels/pages/Explore";
import TravelsWishlist from "@/travels/pages/Wishlist";
import TravelsDestinations from "@/travels/pages/Destinations";
import TravelsTravelCalendar from "@/travels/pages/TravelCalendar";
import TravelsGmailReview from "@/travels/pages/GmailReview";
import TravelsDocuments from "@/travels/pages/Documents";
import TravelsPrivacyPolicy from "@/travels/pages/PrivacyPolicy";
import TravelsTripShare from "@/travels/pages/TripShare";
import { OfficeLayout } from "@/office/components/OfficeLayout";
import OfficeHome from "@/office/pages/home";
import OfficeGmail from "@/office/pages/gmail";
import OfficeCalendar from "@/office/pages/calendar";
import OfficeNotes from "@/office/pages/notes";

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
    window.location.href = "/";
  }, []);
  return <Splash />;
}

function Routes() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) redirectToMainLogin();
  }, [isLoading, user]);

  // Only subscribe once authenticated — the SSE endpoint requires a session.
  useRealtimeInvalidation(!!user);

  if (isLoading || !user) return <Splash />;

  return (
    <ModuleShell>
      <BulkAddProvider>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/pottery" component={PotteryCollection} />
          <Route path="/pottery/add" component={PotteryAdd} />
          <Route path="/pottery/compare" component={PotteryCompare} />
          <Route path="/pottery/scan" component={PotteryScan} />
          <Route path="/pottery/stats" component={PotteryStats} />
          <Route path="/pottery/piece/:id" component={PotteryDetail} />
          <Route path="/pottery/categories" component={PotteryCategories} />
          <Route path="/pottery/maintenance" component={PotteryMaintenance} />
          <Route path="/quilting" component={Fabrics} />
          <Route path="/quilting/fabrics" component={Fabrics} />
          <Route path="/quilting/fabrics/add" component={AddFabric} />
          <Route path="/quilting/fabrics/bulk-add" component={BulkAddFabric} />
          <Route path="/quilting/fabrics/:id" component={FabricDetail} />
          <Route path="/quilting/patterns" component={Patterns} />
          <Route path="/quilting/patterns/add" component={AddPattern} />
          <Route path="/quilting/patterns/:id" component={PatternDetail} />
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
          <Route path="/quilting/blocks/:id/edit" component={BlockDesigner} />
          <Route path="/quilting/blocks/:id" component={BlockDetail} />
          <Route path="/quilting/library/blocks" component={BlockLibrary} />
          <Route
            path="/quilting/library/blocks/new"
            component={BlockDesigner}
          />
          <Route
            path="/quilting/library/blocks/:id/edit"
            component={BlockDesigner}
          />
          <Route path="/quilting/layouts" component={Layouts} />
          <Route path="/quilting/layouts/new" component={LayoutComposer} />
          <Route path="/quilting/layouts/:id/edit" component={LayoutComposer} />
          <Route path="/quilting/layouts/:id" component={LayoutDetail} />
          <Route path="/quilting/whole-quilt" component={WholeQuiltList} />
          <Route
            path="/quilting/whole-quilt/designer"
            component={WholeQuiltDesigner}
          />
          <Route path="/quilting/shopping" component={Shopping} />
          <Route path="/quilting/tools/yardage" component={YardageCalculator} />
          <Route path="/quilting/categories" component={QuiltingCategories} />
          <Route path="/quilting/maintenance" component={QuiltingMaintenance} />
          <Route
            path="/quilting/dev/fabric-compare"
            component={FabricCompareDevPage}
          />
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
          <Route path="/ornaments/scan" component={OrnamentsScan} />
          <Route path="/ornaments/stats" component={OrnamentsStats} />
          <Route path="/ornaments/categories" component={OrnamentsCategories} />
          <Route
            path="/ornaments/maintenance"
            component={OrnamentsMaintenance}
          />
          <Route
            path="/ornaments/hallmark-events"
            component={OrnamentsHallmarkEvents}
          />
          <Route path="/ornaments/ornament/:id" component={OrnamentsDetail} />
          <Route path="/office">
            <OfficeLayout>
              <OfficeHome />
            </OfficeLayout>
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
          <Route component={NotFound} />
        </Switch>
      </BulkAddProvider>
    </ModuleShell>
  );
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/travels/trips/:id/share" component={TravelsTripShare} />
      <Route path="/travels/privacy" component={TravelsPrivacyPolicy} />
      <Route>
        <AuthProvider>
          <ElainePageContextProvider>
            <Routes />
          </ElainePageContextProvider>
        </AuthProvider>
      </Route>
    </Switch>
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
