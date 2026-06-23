import { useState } from "react";
import {
  Library,
  ShoppingBag,
  PenTool,
  Settings2,
  Search,
  Plus,
  ChevronUp,
  LayoutGrid,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const FABRICS = [
  { id: 1, name: "Navy Crosshatch", tags: ["cotton", "geometric"], qty: 3, bg: "bg-[#1e3a5f]" },
  { id: 2, name: "Warm Cream Linen", tags: ["linen", "solid"], qty: 1, bg: "bg-[#f5efe0]" },
  { id: 3, name: "Forest Medallion", tags: ["cotton", "floral"], qty: 2, bg: "bg-[#2d5a3d]" },
  { id: 4, name: "Dusty Rose Dots", tags: ["cotton", "dots"], qty: 1, bg: "bg-[#e8bfbf]" },
  { id: 5, name: "Charcoal Stripe", tags: ["woven", "stripe"], qty: 4, bg: "bg-[#4a4a4a]" },
  { id: 6, name: "Ochre Field", tags: ["linen", "solid"], qty: 2, bg: "bg-[#c8860a]" },
  { id: 7, name: "Indigo Batik", tags: ["batik", "hand-dyed"], qty: 1, bg: "bg-[#2e3a7a]" },
  { id: 8, name: "Sage Gingham", tags: ["cotton", "check"], qty: 3, bg: "bg-[#8db89a]" },
];

const TABS = [
  { label: "Collection", icon: Library, active: true },
  { label: "Shopping", icon: ShoppingBag, active: false },
  { label: "Design", icon: PenTool, active: false },
  { label: "Settings", icon: Settings2, active: false },
];

const QUICK_FILTERS = ["All", "Cotton", "Linen", "Batik", "Woven"];

function QuiltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.9" />
      <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.6" />
      <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.6" />
      <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.9" />
    </svg>
  );
}

export function QMobile() {
  const [activeTab, setActiveTab] = useState("Collection");
  const [activeFilter, setActiveFilter] = useState("All");

  return (
    <div className="w-full h-screen bg-background text-foreground flex flex-col font-sans overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-border bg-background/90 backdrop-blur-md z-40">
        <div className="flex h-14 items-center justify-between px-4">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <a href="/" className="p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors">
              <LayoutGrid className="h-4 w-4" />
            </a>
            <div className="h-3.5 w-px bg-border mx-0.5" />
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center text-primary-foreground shrink-0">
                <QuiltIcon />
              </div>
              <div className="leading-tight">
                <p className="text-sm font-bold tracking-tight leading-none">Ashley's Quilting</p>
                <p className="text-[9px] text-muted-foreground mt-0.5">Studio Collection</p>
              </div>
            </div>
          </div>
          {/* Right */}
          <div className="flex items-center gap-1.5">
            <button className="p-2 rounded-lg text-muted-foreground hover:bg-muted transition-colors">
              <Search className="h-4 w-4" />
            </button>
            <Avatar className="h-7 w-7 border border-border">
              <AvatarFallback className="bg-primary text-primary-foreground text-[10px] font-bold">AB</AvatarFallback>
            </Avatar>
          </div>
        </div>
      </header>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto pb-20">

        {/* Page title + action */}
        <div className="flex items-center justify-between px-4 pt-5 pb-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">My Fabrics</h1>
            <p className="text-xs text-muted-foreground">48 fabrics · 127 yards</p>
          </div>
          <Button size="sm" className="h-8">
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </div>

        {/* Quick stats — horizontal scroll */}
        <div className="flex gap-2.5 px-4 pb-4 overflow-x-auto scrollbar-none">
          {[
            { label: "Fabrics", value: "48" },
            { label: "Patterns", value: "9" },
            { label: "Quilts", value: "5" },
            { label: "Shopping", value: "12" },
          ].map(({ label, value }) => (
            <div key={label} className="shrink-0 rounded-xl border border-border bg-card px-4 py-3 min-w-[90px]">
              <p className="text-xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        {/* Filter chips */}
        <div className="flex gap-1.5 px-4 pb-4 overflow-x-auto scrollbar-none">
          {QUICK_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                activeFilter === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Fabric grid — 2 col */}
        <div className="grid grid-cols-2 gap-3 px-4">
          {FABRICS.map((fabric) => (
            <div
              key={fabric.id}
              className="rounded-xl border border-border bg-card overflow-hidden active:opacity-80 transition-opacity cursor-pointer"
            >
              {/* Swatch */}
              <div className={`h-28 ${fabric.bg} relative flex items-end p-2`}>
                <span className="inline-flex items-center rounded-full bg-black/30 backdrop-blur-sm px-1.5 py-0.5 text-[9px] font-medium text-white">
                  × {fabric.qty}
                </span>
              </div>
              {/* Info */}
              <div className="p-2.5">
                <p className="text-xs font-semibold leading-snug">{fabric.name}</p>
                <p className="text-[10px] text-muted-foreground mt-1 capitalize">{fabric.tags[0]}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bottom tab bar ──────────────────────────────────────────────── */}
      <nav className="shrink-0 fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur-md z-50">
        <div className="flex items-stretch justify-around px-2 py-1.5 max-w-sm mx-auto">
          {TABS.map(({ label, icon: Icon }) => {
            const isActive = activeTab === label;
            return (
              <button
                key={label}
                onClick={() => setActiveTab(label)}
                className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className={`h-5 w-5 transition-transform ${isActive ? "scale-110" : ""}`} />
                {label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
