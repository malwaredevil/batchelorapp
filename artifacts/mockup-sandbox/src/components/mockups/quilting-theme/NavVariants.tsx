import { useState } from "react";
import {
  Library,
  ShoppingBag,
  PenTool,
  Settings2,
  Search,
  ChevronDown,
  Check,
  LayoutGrid,
  Home,
  Layers,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const NAV = [
  { label: "Collection", icon: Library },
  { label: "Shopping", icon: ShoppingBag },
  { label: "Design", icon: PenTool },
  { label: "Settings", icon: Settings2 },
];

function QuiltIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.9" />
      <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.6" />
      <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.6" />
      <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.9" />
    </svg>
  );
}

function BBadge({ size = 8 }: { size?: number }) {
  return (
    <div
      className="rounded-lg bg-primary flex items-center justify-center shadow-sm shrink-0 text-primary-foreground font-bold"
      style={{ width: size * 4, height: size * 4, fontSize: size * 1.4 }}
    >
      B
    </div>
  );
}

function NavRight({ active }: { active: string }) {
  return (
    <div className="flex items-center gap-4 shrink-0">
      <nav className="flex items-center gap-0.5">
        {NAV.map(({ label, icon: Icon }) => (
          <button
            key={label}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
              active === label
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>
      <button className="hidden md:flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors">
        <Search className="h-3.5 w-3.5" />
        <span>Search…</span>
        <kbd className="hidden lg:inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
      </button>
      <div className="pl-2 border-l border-border flex items-center gap-2">
        <div className="text-right leading-tight hidden lg:block">
          <p className="text-xs font-medium leading-none">Ashley B.</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Maker account</p>
        </div>
        <Avatar className="h-8 w-8 border border-border">
          <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">AB</AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}

/* ── Variant A: Breadcrumb ─────────────────────────────────────────────
   [B badge] Batchelor  ›  [Q badge] Quilting
   Clicking "Batchelor" returns to the launcher.
   Pattern: GitHub, Vercel, Render, Railway                             */
function HeaderA() {
  return (
    <header className="border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
        <div className="flex items-center gap-2.5 shrink-0">
          <a
            href="/"
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted transition-colors group"
            title="Back to Batchelor"
          >
            <BBadge size={7} />
            <span className="text-sm font-semibold text-muted-foreground group-hover:text-foreground transition-colors">Batchelor</span>
          </a>
          <span className="text-border select-none text-lg font-light">›</span>
          <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted transition-colors">
            <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center text-primary-foreground shrink-0">
              <QuiltIcon size={14} />
            </div>
            <span className="text-sm font-bold text-foreground">Ashley's Quilting</span>
          </button>
        </div>
        <div className="flex-1" />
        <NavRight active="Collection" />
      </div>
    </header>
  );
}

/* ── Variant B: App-switcher pill ──────────────────────────────────────
   [ Q  Ashley's Quilting  ▾ ]  — click opens mini-picker dropdown.
   Pattern: Slack, Linear, Vercel team picker                           */

function PotteryIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 3h6l1 3H4L5 3z" fill="currentColor" fillOpacity="0.9" />
      <path d="M4 6c0 0-1 1.5-1 3.5C3 12 5 14 8 14s5-2 5-4.5C13 7.5 12 6 12 6H4z" fill="currentColor" fillOpacity="0.85" />
    </svg>
  );
}

type AppEntry = {
  id: string;
  label: string;
  sub: string;
  active?: boolean;
  icon: React.ReactNode;
};

function AppBadge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
      {children}
    </div>
  );
}

function HeaderB({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  const apps: AppEntry[] = [
    {
      id: "launcher",
      label: "Batchelor Hub",
      sub: "Home — all your collections",
      icon: (
        <AppBadge color="bg-foreground text-background">
          <Home className="h-4 w-4" />
        </AppBadge>
      ),
    },
    {
      id: "pottery",
      label: "Batchelor Pottery",
      sub: "163 pieces",
      icon: (
        <AppBadge color="bg-amber-600 text-white">
          <PotteryIcon size={14} />
        </AppBadge>
      ),
    },
    {
      id: "quilting",
      label: "Ashley's Quilting",
      sub: "48 fabrics",
      active: true,
      icon: (
        <AppBadge color="bg-primary text-primary-foreground">
          <QuiltIcon size={14} />
        </AppBadge>
      ),
    },
  ];

  return (
    <header className="border-b border-border bg-background/90 backdrop-blur-md relative">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
        {/* Switcher pill */}
        <div className="relative shrink-0">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2 hover:bg-muted transition-colors"
          >
            <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center text-primary-foreground shrink-0">
              <QuiltIcon size={14} />
            </div>
            <div className="text-left leading-tight">
              <p className="text-sm font-bold leading-none">Ashley's Quilting</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Switch app…</p>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground ml-1 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>

          {open && (
            <div className="absolute top-full left-0 mt-1.5 w-64 rounded-xl border border-border bg-background shadow-xl z-50 overflow-hidden py-1">
              {apps.map((app, i) => (
                <div key={app.id}>
                  {/* Divider between Home and the app entries */}
                  {i === 1 && (
                    <div className="mx-3 my-1 border-t border-border" />
                  )}
                  <button
                    className="flex w-full items-center gap-3 px-3 py-2.5 hover:bg-muted transition-colors text-left"
                    onClick={() => setOpen(false)}
                  >
                    {app.icon}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate leading-none">{app.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{app.sub}</p>
                    </div>
                    {app.active && <Check className="h-4 w-4 text-primary shrink-0" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1" />
        <NavRight active="Collection" />
      </div>
    </header>
  );
}

/* ── Variant C: Badge IS the home link — no extra text ─────────────────
   The quilt badge in the logo area is itself a tappable home link
   (hover shows a subtle "Back to Batchelor" tooltip).
   No "All Apps" text anywhere — the logo click is the paradigm.
   Pattern: most single-brand mobile apps, Gmail, Drive                 */
function HeaderC() {
  const [hovered, setHovered] = useState(false);
  return (
    <header className="border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
        <div className="flex items-center gap-3 shrink-0">
          {/* The quilt badge IS the home button */}
          <div className="relative">
            <a
              href="/"
              className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-sm hover:opacity-85 transition-opacity block"
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
            >
              <QuiltIcon size={18} />
            </a>
            {hovered && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 whitespace-nowrap rounded-lg bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background shadow-md z-50">
                Back to Batchelor
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-foreground" />
              </div>
            )}
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold tracking-tight leading-none">Ashley's Quilting</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Studio Collection</p>
          </div>
        </div>
        <div className="flex-1" />
        <NavRight active="Collection" />
      </div>
    </header>
  );
}

/* ── Variant D: Larger standalone home icon — no words ─────────────────
   A properly sized LayoutGrid or Home icon stands alone as the
   launcher shortcut. Bigger, more intentional, no awkward text.
   Optionally with a very subtle label below it.                        */
function HeaderD() {
  return (
    <header className="border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
        <div className="flex items-center gap-3 shrink-0">
          <a
            href="/"
            className="flex flex-col items-center gap-0.5 rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors group"
            title="Back to Batchelor"
          >
            <LayoutGrid className="h-5 w-5" />
            <span className="text-[9px] font-medium leading-none opacity-70 group-hover:opacity-100">Home</span>
          </a>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground shrink-0">
              <QuiltIcon size={15} />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-tight leading-none">Ashley's Quilting</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Studio Collection</p>
            </div>
          </div>
        </div>
        <div className="flex-1" />
        <NavRight active="Collection" />
      </div>
    </header>
  );
}

/* ── Main component: all 4 stacked with labels ─────────────────────── */
export function NavVariants() {
  return (
    <div className="min-h-screen bg-background font-sans">
      <div className="mx-auto max-w-6xl py-8 px-6 space-y-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Home Link Variants</h1>
          <p className="text-muted-foreground text-sm mt-1">Four approaches to the "go back to launcher" element. Hover / click each to try them live.</p>
        </div>

        {/* A */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold shrink-0">A</div>
            <div>
              <p className="text-sm font-semibold">Breadcrumb — Platform › App</p>
              <p className="text-xs text-muted-foreground">Click "Batchelor" to go home. GitHub, Vercel, Railway all use this.</p>
            </div>
          </div>
          <div className="rounded-xl border border-border overflow-hidden shadow-sm">
            <HeaderA />
          </div>
        </div>

        {/* B */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold shrink-0">B</div>
            <div>
              <p className="text-sm font-semibold">App-switcher pill with dropdown</p>
              <p className="text-xs text-muted-foreground">Dropdown shown open — click the pill to toggle it. Batchelor Hub = home. Slack, Linear, Vercel team picker pattern.</p>
            </div>
          </div>
          <div className="rounded-xl border border-border overflow-hidden shadow-sm" style={{ minHeight: 240 }}>
            <HeaderB defaultOpen={true} />
          </div>
        </div>

        {/* C */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold shrink-0">C</div>
            <div>
              <p className="text-sm font-semibold">Badge is the home link — no extra text</p>
              <p className="text-xs text-muted-foreground">Click the quilt badge itself to return to the launcher. Hover it to see the tooltip. Most minimal.</p>
            </div>
          </div>
          <div className="rounded-xl border border-border overflow-hidden shadow-sm">
            <HeaderC />
          </div>
        </div>

        {/* D */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold shrink-0">D</div>
            <div>
              <p className="text-sm font-semibold">Larger grid icon + "Home" label</p>
              <p className="text-xs text-muted-foreground">Same concept as current but properly sized, with a small "Home" label underneath. Separated from the app name.</p>
            </div>
          </div>
          <div className="rounded-xl border border-border overflow-hidden shadow-sm">
            <HeaderD />
          </div>
        </div>
      </div>
    </div>
  );
}
