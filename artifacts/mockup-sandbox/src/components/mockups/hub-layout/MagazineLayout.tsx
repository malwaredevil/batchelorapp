import { useState } from "react";
import {
  Sun, Moon, Search, Plus, Settings, ArrowRight, LayoutGrid,
  ChevronDown, Scissors, Maximize2, ShoppingBag, Activity,
  Package, Shirt, Star, Wind, Sparkles, X, MoreHorizontal, RefreshCw
} from "lucide-react";

export default function MagazineLayout() {
  const [dark, setDark] = useState(false);
  const [spotlight, setSpotlight] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const spotlightItems = [
    { name: "Blue Celadon Bowl", app: "Pottery", tag: "Glazed stoneware", color: "from-amber-100 to-amber-200 dark:from-amber-900/30 dark:to-amber-800/20" },
    { name: "Bear Claw Block", app: "Quilting", tag: "8″ block design", color: "from-violet-100 to-violet-200 dark:from-violet-900/30 dark:to-violet-800/20" },
    { name: "Speckled Raku Vase", app: "Pottery", tag: "Raku fired", color: "from-stone-100 to-stone-200 dark:from-stone-800/30 dark:to-stone-700/20" },
  ];

  const current = spotlightItems[spotlight % spotlightItems.length];

  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-background text-foreground font-sans">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-background/90 backdrop-blur-md border-b border-border px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-foreground flex items-center justify-center">
              <LayoutGrid className="w-4 h-4 text-background" />
            </div>
            <span className="font-semibold text-sm">Batchelor</span>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div className="flex items-center gap-2">
            <button className="hidden md:flex items-center gap-2 text-sm text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors">
              <Search className="w-3.5 h-3.5" /> Search everything...
              <kbd className="ml-2 text-[10px] border border-border rounded px-1 py-0.5 bg-muted font-mono">⌘K</kbd>
            </button>
            <button onClick={() => setDark(d => !d)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><Settings className="w-4 h-4" /></button>
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold ml-1">SC</div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-8">
          {/* Page title */}
          <div className="flex items-end justify-between mb-6">
            <div>
              <p className="text-sm text-muted-foreground font-medium">Tuesday, 24 June</p>
              <h1 className="text-3xl font-bold mt-0.5">Good morning, Sarah.</h1>
            </div>
            <button className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              <Plus className="w-4 h-4" /> Add item
            </button>
          </div>

          {/* Main magazine grid */}
          <div className="grid grid-cols-3 gap-4">
            {/* Hero spotlight widget — 2/3 width */}
            <div className="col-span-2 space-y-4">
              {/* Spotlight card */}
              <div className={`relative rounded-2xl bg-gradient-to-br ${current.color} border border-border overflow-hidden`}>
                <div className="p-6 pb-0 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Collection spotlight</span>
                    </div>
                    <h2 className="text-2xl font-bold text-foreground">{current.name}</h2>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs bg-background/60 px-2 py-1 rounded-md font-medium">{current.app}</span>
                      <span className="text-xs text-muted-foreground">{current.tag}</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => setSpotlight(s => s + 1)} className="p-2 rounded-lg bg-background/40 hover:bg-background/60 text-muted-foreground transition-colors">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button className="p-2 rounded-lg bg-background/40 hover:bg-background/60 text-muted-foreground transition-colors">
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mx-6 mt-4 h-40 rounded-t-xl bg-background/30 border-t border-x border-border/50 flex items-center justify-center">
                  <div className="text-muted-foreground/40 text-sm">Collection photo</div>
                </div>
              </div>

              {/* Two-up row */}
              <div className="grid grid-cols-2 gap-4">
                {/* Pottery stats */}
                <div className="bg-card border border-border rounded-xl p-4 group hover:shadow-sm transition-shadow cursor-pointer" onClick={() => setExpanded(expanded === "pottery" ? null : "pottery")}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                        <Package className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      </div>
                      <span className="font-semibold text-sm">Pottery</span>
                    </div>
                    <ArrowRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded === "pottery" ? "rotate-90" : ""}`} />
                  </div>
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-bold">163</span>
                    <span className="text-muted-foreground text-sm mb-1 ml-1">pieces</span>
                  </div>
                  <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                    <span>12 categories</span>
                    <span>·</span>
                    <span>+3 this month</span>
                  </div>
                  {expanded === "pottery" && (
                    <div className="mt-3 pt-3 border-t border-border space-y-1.5">
                      {["Blue celadon bowl", "Raku vase", "Speckled mug"].map((i, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm py-1 hover:bg-muted/50 rounded px-1 cursor-pointer">
                          <div className="w-6 h-6 rounded bg-amber-100 dark:bg-amber-900/30 flex-shrink-0" />
                          <span className="text-muted-foreground truncate">{i}</span>
                        </div>
                      ))}
                      <a href="#" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline mt-2">
                        Open collection <ArrowRight className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                </div>

                {/* Quilting stats */}
                <div className="bg-card border border-border rounded-xl p-4 group hover:shadow-sm transition-shadow cursor-pointer" onClick={() => setExpanded(expanded === "quilting" ? null : "quilting")}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                        <Shirt className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                      </div>
                      <span className="font-semibold text-sm">Quilting</span>
                    </div>
                    <ArrowRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded === "quilting" ? "rotate-90" : ""}`} />
                  </div>
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-bold">46</span>
                    <span className="text-muted-foreground text-sm mb-1 ml-1">fabrics</span>
                  </div>
                  <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                    <span>13 blocks</span>
                    <span>·</span>
                    <span>1 layout</span>
                  </div>
                  {expanded === "quilting" && (
                    <div className="mt-3 pt-3 border-t border-border space-y-1.5">
                      {["Kona cotton — navy", "Teal stripe print", "White muslin"].map((i, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm py-1 hover:bg-muted/50 rounded px-1 cursor-pointer">
                          <div className="w-6 h-6 rounded bg-violet-100 dark:bg-violet-900/30 flex-shrink-0" />
                          <span className="text-muted-foreground truncate">{i}</span>
                        </div>
                      ))}
                      <a href="#" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline mt-2">
                        Open quilting <ArrowRight className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right sidebar — 1/3 width, stacked widgets */}
            <div className="col-span-1 space-y-4">
              {/* Weather */}
              <div className="bg-card border border-border rounded-xl p-4 overflow-hidden relative">
                <div className="absolute inset-0 bg-gradient-to-br from-sky-400/10 to-blue-500/5 pointer-events-none" />
                <div className="relative flex items-start justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground font-medium">Reichenbach</div>
                    <div className="text-3xl font-light mt-1">17°C</div>
                    <div className="text-sm text-muted-foreground mt-0.5">Partly cloudy</div>
                  </div>
                  <div className="text-4xl">⛅</div>
                </div>
              </div>

              {/* Shopping list */}
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="w-3.5 h-3.5 text-rose-500" />
                    <span className="text-sm font-semibold">Shopping</span>
                  </div>
                  <span className="text-xs bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 rounded-full font-medium">3</span>
                </div>
                {[
                  { name: "Kona Navy", qty: "2 yds", status: "want" },
                  { name: "Batting", qty: "1", status: "ordered" },
                  { name: "Teal stripe", qty: "1.5 yds", status: "want" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2.5 py-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.status === "ordered" ? "bg-emerald-400" : "bg-rose-400"}`} />
                    <span className="text-sm flex-1 truncate">{item.name}</span>
                    <span className="text-xs text-muted-foreground">{item.qty}</span>
                  </div>
                ))}
              </div>

              {/* Recent activity */}
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-sm font-semibold">Recent</span>
                </div>
                {[
                  { label: "Added 'Speckled Mug'", time: "2h ago", app: "pottery" },
                  { label: "Updated fabric stash", time: "Yesterday", app: "quilting" },
                  { label: "'Bear Claw' block", time: "2d ago", app: "quilting" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2 py-1.5 cursor-pointer hover:bg-muted/40 rounded px-1 -mx-1 transition-colors">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${item.app === "pottery" ? "bg-amber-400" : "bg-violet-400"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{item.label}</div>
                      <div className="text-xs text-muted-foreground">{item.time}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick add */}
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-sm font-semibold mb-3">Quick add</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Pottery piece", icon: Package, color: "hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:border-amber-200 dark:hover:border-amber-800" },
                    { label: "Fabric", icon: Shirt, color: "hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:border-violet-200 dark:hover:border-violet-800" },
                    { label: "Block", icon: Scissors, color: "hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:border-violet-200 dark:hover:border-violet-800" },
                    { label: "Pattern", icon: Star, color: "hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:border-violet-200 dark:hover:border-violet-800" },
                  ].map(a => (
                    <button key={a.label} className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border border-border text-xs font-medium transition-colors ${a.color}`}>
                      <a.icon className="w-4 h-4 text-muted-foreground" />
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
