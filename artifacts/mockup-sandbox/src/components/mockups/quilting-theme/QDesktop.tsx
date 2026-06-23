import { useState } from "react";
import {
  Library,
  ShoppingBag,
  PenTool,
  Settings2,
  Search,
  Plus,
  Filter,
  LayoutGrid,
  ChevronDown,
  LogOut,
  Sun,
  Moon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const FABRICS = [
  { id: 1, name: "Navy Crosshatch", tags: ["cotton", "geometric"], qty: 3, bg: "bg-[#1e3a5f]", textLight: true },
  { id: 2, name: "Warm Cream Linen", tags: ["linen", "solid"], qty: 1, bg: "bg-[#f5efe0]", textLight: false },
  { id: 3, name: "Forest Medallion", tags: ["cotton", "floral"], qty: 2, bg: "bg-[#2d5a3d]", textLight: true },
  { id: 4, name: "Dusty Rose Dots", tags: ["cotton", "dots"], qty: 1, bg: "bg-[#e8bfbf]", textLight: false },
  { id: 5, name: "Charcoal Stripe", tags: ["woven", "stripe"], qty: 4, bg: "bg-[#4a4a4a]", textLight: true },
  { id: 6, name: "Ochre Field", tags: ["linen", "solid"], qty: 2, bg: "bg-[#c8860a]", textLight: true },
  { id: 7, name: "Indigo Batik", tags: ["batik", "hand-dyed"], qty: 1, bg: "bg-[#2e3a7a]", textLight: true },
  { id: 8, name: "Sage Gingham", tags: ["cotton", "check"], qty: 3, bg: "bg-[#8db89a]", textLight: false },
  { id: 9, name: "Terracotta Weave", tags: ["woven", "earthy"], qty: 2, bg: "bg-[#b5522a]", textLight: true },
  { id: 10, name: "Ivory Floral", tags: ["cotton", "floral"], qty: 5, bg: "bg-[#f2ede4]", textLight: false },
  { id: 11, name: "Deep Teal Shot", tags: ["dupioni", "solid"], qty: 1, bg: "bg-[#1a6b6b]", textLight: true },
  { id: 12, name: "Lavender Sprig", tags: ["cotton", "floral"], qty: 2, bg: "bg-[#c4b0d8]", textLight: false },
];

const QUICK_FILTERS = ["All", "Cotton", "Linen", "Batik", "Woven", "Floral", "Geometric", "Solids"];

const NAV = [
  { label: "Collection", icon: Library },
  { label: "Shopping", icon: ShoppingBag },
  { label: "Design", icon: PenTool },
  { label: "Settings", icon: Settings2 },
];

function QuiltIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.9" />
      <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.6" />
      <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.6" />
      <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.9" />
    </svg>
  );
}

export function QDesktop() {
  const [activeNav, setActiveNav] = useState("Collection");
  const [activeFilter, setActiveFilter] = useState("All");
  const [dark, setDark] = useState(false);

  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">

            {/* Brand */}
            <div className="flex items-center gap-3 shrink-0">
              <a href="/" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 px-2 rounded-md hover:bg-muted">
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">All Apps</span>
              </a>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shadow-sm shrink-0 text-primary-foreground">
                  <QuiltIcon />
                </div>
                <div className="leading-tight">
                  <p className="text-sm font-bold tracking-tight leading-none">Ashley's Quilting</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Studio Collection</p>
                </div>
              </div>
            </div>

            {/* Nav pills */}
            <nav className="flex items-center gap-0.5 flex-1 justify-center">
              {NAV.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  onClick={() => setActiveNav(label)}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                    activeNav === label
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </nav>

            {/* Right actions */}
            <div className="flex items-center gap-2 shrink-0">
              <button className="hidden md:flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors">
                <Search className="h-3.5 w-3.5" />
                <span className="text-sm">Search…</span>
                <kbd className="hidden lg:inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
              </button>
              <button
                onClick={() => setDark((d) => !d)}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <div className="pl-2 border-l border-border flex items-center gap-2.5">
                <div className="hidden lg:block text-right leading-tight">
                  <p className="text-xs font-medium leading-none">Ashley B.</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Maker account</p>
                </div>
                <Avatar className="h-8 w-8 border border-border cursor-pointer">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">AB</AvatarFallback>
                </Avatar>
              </div>
            </div>
          </div>
        </header>

        {/* ── Main ───────────────────────────────────────────────────────── */}
        <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-8">

          {/* Welcome row */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Good morning, Ashley.</h1>
              <p className="text-muted-foreground mt-1">Your studio at a glance.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <Search className="mr-1.5 h-3.5 w-3.5" />
                AI search
              </Button>
              <Button size="sm">
                <Plus className="mr-1.5 h-4 w-4" />
                Add fabric
              </Button>
            </div>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-4 gap-3 mb-8">
            {[
              { label: "Fabrics", value: "48", sub: "in stash" },
              { label: "Patterns", value: "9", sub: "saved" },
              { label: "Quilts", value: "5", sub: "in progress" },
              { label: "Shopping", value: "12", sub: "items wanted" },
            ].map(({ label, value, sub }) => (
              <div key={label} className="rounded-xl border border-border bg-card p-4">
                <p className="text-2xl font-bold text-foreground">{value}</p>
                <p className="text-sm font-medium text-foreground mt-0.5">{label}</p>
                <p className="text-xs text-muted-foreground">{sub}</p>
              </div>
            ))}
          </div>

          {/* Section header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">My Fabrics</h2>
              <p className="text-xs text-muted-foreground">48 fabrics · 127 total yards</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <Filter className="mr-1.5 h-3.5 w-3.5" />
                Filter
              </Button>
            </div>
          </div>

          {/* Quick filter pills */}
          <div className="flex items-center gap-1.5 mb-5 flex-wrap">
            {QUICK_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                  activeFilter === f
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Fabric grid */}
          <div className="grid grid-cols-3 xl:grid-cols-4 gap-4">
            {FABRICS.map((fabric) => (
              <div
                key={fabric.id}
                className="group rounded-xl border border-border bg-card overflow-hidden hover:shadow-md hover:border-primary/25 transition-all cursor-pointer"
              >
                {/* Swatch */}
                <div className={`h-32 ${fabric.bg} relative flex items-end p-2`}>
                  <span className="inline-flex items-center rounded-full bg-black/30 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-white">
                    × {fabric.qty}
                  </span>
                </div>
                {/* Info */}
                <div className="p-3">
                  <p className="text-sm font-semibold leading-snug">{fabric.name}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {fabric.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground capitalize">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
