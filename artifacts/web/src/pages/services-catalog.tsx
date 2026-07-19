import { ExternalLink } from "lucide-react";

type Module =
  | "Pottery"
  | "Quilting"
  | "Ornaments"
  | "Travels"
  | "Office"
  | "Elaine"
  | "Hub"
  | "All";

type ServiceEntry = {
  name: string;
  purpose: string;
  usedFor: string;
  implementedIn: string[];
  modules: Module[];
  env: string[];
};

const SERVICES: ServiceEntry[] = [
  {
    name: "Supabase",
    purpose: "PostgreSQL database and private object storage",
    usedFor:
      "All application data (pottery, quilting, ornaments, travels, users). Private image buckets for pottery, quilting, ornaments, and travel documents.",
    implementedIn: [
      "lib/db/src/",
      "artifacts/api-server/src/lib/storage-core.ts",
    ],
    modules: ["All"],
    env: [
      "DATABASE_URL",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_POOLER_HOST",
    ],
  },
  {
    name: "OpenRouter",
    purpose: "Unified AI gateway (LLM routing)",
    usedFor:
      "Powers virtually all AI features: Elaine assistant chat, item analysis (pottery, ornaments), fabric/pattern analysis, birthday emails, document extraction from travel attachments, and Elaine's sub-agent reasoning.",
    implementedIn: ["artifacts/api-server/src/lib/ai-client.ts"],
    modules: ["Pottery", "Quilting", "Ornaments", "Travels", "Elaine", "All"],
    env: ["OPENROUTER_API_KEY"],
  },
  {
    name: "Jina AI",
    purpose: "CLIP visual embeddings and web page reader",
    usedFor:
      "Visual similarity search for pottery and fabrics (CLIP embeddings). Zero-shot classification of glaze types (pottery) and print types (quilting). Elaine web-reader tool converts URLs to markdown for the assistant.",
    implementedIn: [
      "artifacts/api-server/src/lib/visual-embed.ts",
      "artifacts/api-server/src/lib/web-search.ts",
    ],
    modules: ["Pottery", "Quilting", "Elaine"],
    env: ["JINA_API_KEY"],
  },
  {
    name: "Voyage AI",
    purpose: "Neural reranking for search results",
    usedFor:
      "Re-scores candidate matches in the pottery and quilting Compare feature, improving search precision by ranking results against a natural-language description.",
    implementedIn: ["artifacts/api-server/src/lib/reranker.ts"],
    modules: ["Pottery", "Quilting"],
    env: ["VOYAGE_API_KEY"],
  },
  {
    name: "Google OAuth",
    purpose: "User authentication via Google identity",
    usedFor:
      "Sign in with Google. Also the authorization layer for granting the app access to a user's Gmail and Google Calendar data.",
    implementedIn: ["artifacts/api-server/src/lib/google-oauth.ts"],
    modules: ["Hub", "Travels", "Office"],
    env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  {
    name: "Gmail API",
    purpose: "Per-user Gmail inbox access",
    usedFor:
      "Travel document scanning: auto-detects flight/hotel confirmation emails and extracts structured trip data. Office module: manual inbox browsing, email composition, label management.",
    implementedIn: ["artifacts/api-server/src/lib/gmail-api.ts"],
    modules: ["Travels", "Office"],
    env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  {
    name: "Google Calendar API",
    purpose: "Calendar read/write for trip and reminder sync",
    usedFor:
      "Syncs Travels trip dates and reminders to a designated shared Google Calendar. Also manages Hallmark ornament release event entries in that calendar.",
    implementedIn: ["artifacts/api-server/src/lib/google-calendar.ts"],
    modules: ["Travels", "Ornaments"],
    env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  {
    name: "Google Maps Platform",
    purpose: "Maps, Places, Directions APIs",
    usedFor:
      "Destination maps and world-map visualisation in the Travels module. Location autocomplete when adding trip destinations. Route and distance lookups for Elaine.",
    implementedIn: [
      "artifacts/api-server/src/lib/travels/google-maps.ts",
      "artifacts/modules/src/travels/lib/google-maps-loader.ts",
    ],
    modules: ["Travels"],
    env: ["GOOGLE_MAPS_API_KEY", "VITE_GOOGLE_MAPS_API_KEY"],
  },
  {
    name: "Google Wallet API",
    purpose: "Mobile digital-pass issuance",
    usedFor:
      "Lets users add travel documents (boarding passes, hotel reservations) to their Google Wallet as passes.",
    implementedIn: ["artifacts/api-server/src/lib/travels/google-wallet.ts"],
    modules: ["Travels"],
    env: ["GOOGLE_WALLET_ISSUER_ID", "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON"],
  },
  {
    name: "Resend",
    purpose: "Transactional email (outbound + inbound webhook)",
    usedFor:
      "Outbound: password reset, trip reminder alerts, birthday emails, Elaine-composed messages. Inbound: emails forwarded to elaine@app.batchelor.app trigger a restricted Elaine turn with attachment extraction.",
    implementedIn: ["artifacts/api-server/src/lib/email.ts"],
    modules: ["Hub", "Travels", "Elaine"],
    env: [
      "RESEND_API_KEY",
      "RESEND_FROM_EMAIL",
      "RESEND_REMINDER_FROM_EMAIL",
      "RESEND_WEBHOOK_SECRET_DEV",
      "RESEND_WEBHOOK_SECRET_PROD",
    ],
  },
  {
    name: "AgentPhone",
    purpose: "SMS and voice channel",
    usedFor:
      "Household members can text or call the app's number to interact with Elaine via SMS/voice. Inbound messages run a full restricted Elaine turn (household data queries, reminders, travel updates).",
    implementedIn: [
      "artifacts/api-server/src/lib/sms.ts",
      "artifacts/api-server/src/routes/agentphone.ts",
    ],
    modules: ["Elaine"],
    env: ["AGENTPHONE_API_KEY", "AGENTPHONE_WEBHOOK_SECRET"],
  },
  {
    name: "Sentry",
    purpose: "Production error tracking and monitoring",
    usedFor:
      "Captures and reports unhandled exceptions and errors from both the API server and all browser SPAs (modules, web, elaine) in production. Source maps are uploaded at build time so stack traces resolve to original TypeScript. Pre-publish baseline and post-publish delta checks are part of the release checklist.",
    implementedIn: [
      "artifacts/api-server/src/lib/sentry.ts",
      "artifacts/modules/src/sentry.ts",
      "artifacts/web/src/sentry.ts",
      "artifacts/elaine/src/sentry.ts",
    ],
    modules: ["All"],
    env: ["SENTRY_DSN", "VITE_SENTRY_DSN"],
  },
  {
    name: "Apify",
    purpose: "Web scraping and market-price lookup platform",
    usedFor:
      "eBay sold-listing price lookups for pottery and ornaments (market value estimates), Etsy price suggestions for quilting shopping items, live flight price checks for the travels wishlist, Hallmark book-value lookups for ornaments (supplemental to UPCitemdb). Crawls the Hallmark historical and current catalogs via custom actors. Webhook callbacks auto-ingest crawl results on completion (APIFY_WEBHOOK_SECRET gates the inbound webhook). All outbound calls are gated by the APIFY_API_TOKEN secret.",
    implementedIn: [
      "artifacts/api-server/src/lib/apify-client.ts",
      "artifacts/api-server/src/lib/pottery/market-value.ts",
      "artifacts/api-server/src/lib/ornaments/ebay-price.ts",
      "artifacts/api-server/src/lib/quilting/etsy-price.ts",
      "artifacts/api-server/src/lib/travels/flight-prices.ts",
      "artifacts/api-server/src/lib/ornaments/hallmark-book-value.ts",
      "artifacts/api-server/src/routes/ornaments/apify-webhook.ts",
    ],
    modules: ["Pottery", "Quilting", "Ornaments", "Travels"],
    env: ["APIFY_API_TOKEN", "APIFY_WEBHOOK_SECRET"],
  },
  {
    name: "UPCitemdb",
    purpose: "Barcode / UPC product lookup (primary)",
    usedFor:
      "Ornaments barcode scanner: looks up product name, series, and year from a UPC code. Results are permanently cached per UPC so repeat scans never re-hit the API. Open Food Facts is used as a no-key fallback when UPCitemdb returns no result.",
    implementedIn: ["artifacts/api-server/src/lib/ornaments/barcode.ts"],
    modules: ["Ornaments"],
    env: [],
  },
  {
    name: "Open Food Facts",
    purpose: "Barcode / UPC product lookup (fallback)",
    usedFor:
      "Fallback for the ornaments barcode scanner when UPCitemdb returns no result. Public API, no key required. Same permanent per-UPC cache applies.",
    implementedIn: ["artifacts/api-server/src/lib/ornaments/barcode.ts"],
    modules: ["Ornaments"],
    env: [],
  },
];

const MODULE_COLORS: Record<Module, string> = {
  All: "bg-primary/10 text-primary",
  Pottery: "bg-amber-100 text-amber-800",
  Quilting: "bg-purple-100 text-purple-800",
  Ornaments: "bg-red-100 text-red-800",
  Travels: "bg-sky-100 text-sky-800",
  Office: "bg-slate-100 text-slate-700",
  Elaine: "bg-emerald-100 text-emerald-800",
  Hub: "bg-zinc-100 text-zinc-700",
};

export function ServicesCatalogContent() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          API Services Catalog
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          All external APIs and third-party services integrated into the app.
          This page is{" "}
          <span className="font-medium text-foreground">
            manually maintained
          </span>{" "}
          — update it whenever a new service is added or removed (required
          before each GitHub sync per the pre-publish checklist).
        </p>
      </div>

      <div className="space-y-3">
        {SERVICES.map((svc) => (
          <div
            key={svc.name}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-foreground">{svc.name}</h3>
                <p className="text-xs text-muted-foreground">{svc.purpose}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {svc.modules.map((m) => (
                  <span
                    key={m}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${MODULE_COLORS[m]}`}
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>

            <p className="mt-2 text-sm text-foreground/80">{svc.usedFor}</p>

            <div className="mt-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Implemented in
              </p>
              <div className="flex flex-wrap gap-1.5">
                {svc.implementedIn.map((f) => (
                  <code
                    key={f}
                    className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground"
                  >
                    {f}
                  </code>
                ))}
              </div>
            </div>

            {svc.env.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Env / secrets
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {svc.env.map((e) => (
                    <code
                      key={e}
                      className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground"
                    >
                      {e}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ExternalLink className="h-3 w-3 shrink-0" />
        Secrets are stored in Replit Secrets and must be re-entered manually in
        any new environment — see the Secrets checklist in{" "}
        <code className="text-foreground">replit.md</code>.
      </p>
    </div>
  );
}
