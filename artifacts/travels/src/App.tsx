import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, ProtectedRoute } from "@/lib/auth";
import { Layout } from "@/components/Layout";
import { queryClient } from "@/lib/query-client";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/hooks/use-theme";
import { AssistantContextProvider } from "@/lib/assistant-context";

import Dashboard from "@/pages/Dashboard";
import Trips from "@/pages/Trips";
import TripDetail from "@/pages/TripDetail";
import WorldMap from "@/pages/WorldMap";
import Explore from "@/pages/Explore";
import Wishlist from "@/pages/Wishlist";
import Destinations from "@/pages/Destinations";
import Settings from "@/pages/Settings";
import TravelCalendar from "@/pages/TravelCalendar";
import GmailReview from "@/pages/GmailReview";
import ElaineChat from "@/pages/ElaineChat";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/privacy" component={PrivacyPolicy} />

      <Route path="/">
        <ProtectedRoute>
          <Layout>
            <Dashboard />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route path="/trips">
        <ProtectedRoute>
          <Layout>
            <Trips />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route path="/trips/:id">
        {(params) => (
          <ProtectedRoute>
            <Layout>
              <TripDetail id={Number(params.id)} />
            </Layout>
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/map">
        <ProtectedRoute>
          <Layout>
            <WorldMap />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route path="/explore">
        <ProtectedRoute>
          <Layout>
            <Explore />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route path="/wishlist">
        <ProtectedRoute>
          <Layout>
            <Wishlist />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route path="/destinations">
        <ProtectedRoute>
          <Layout>
            <Destinations />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route path="/settings">
        <ProtectedRoute>
          <Layout>
            <Settings />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route path="/travel-calendar">
        <ProtectedRoute>
          <Layout>
            <TravelCalendar />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route path="/gmail">
        <ProtectedRoute>
          <Layout>
            <GmailReview />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route path="/elaine">
        <ProtectedRoute>
          <Layout>
            <ElaineChat />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <ErrorBoundary>
              <AssistantContextProvider>
                <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                  <Router />
                </WouterRouter>
                <Toaster richColors position="top-right" />
              </AssistantContextProvider>
            </ErrorBoundary>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
