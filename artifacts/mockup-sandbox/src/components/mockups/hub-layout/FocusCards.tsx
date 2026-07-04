import { useState } from "react";
import {
  Sun,
  Moon,
  Search,
  Plus,
  Settings,
  ArrowRight,
  LayoutGrid,
  ChevronDown,
  Maximize2,
  ShoppingBag,
  Activity,
  Package,
  Shirt,
  Star,
  Wind,
  Sparkles,
  X,
  Home,
  LogOut,
  ChevronsRight,
  ChevronsLeft,
  Camera,
  Scissors,
  RefreshCw,
  Check,
} from "lucide-react";

type WidgetId =
  | "pottery"
  | "quilting"
  | "random"
  | "activity"
  | "shopping"
  | "weather";

const NAV = [
  { icon: Home, label: "Hub", active: true },
  { icon: Package, label: "Pottery", active: false },
  { icon: Shirt, label: "Quilting", active: false },
  { icon: Settings, label: "Settings", active: false },
];

function RandomPieceWidget({ onExpand }: { onExpand: () => void }) {
  const [piece, setPiece] = useState(0);
  const pieces = [
    {
      name: "Turquoise Raku Bowl",
      desc: "Raku fired · 2022 · Studio",
      app: "Pottery",
    },
    {
      name: "Bear Claw Block",
      desc: '8" block · Log cabin variation',
      app: "Quilting",
    },
    {
      name: "Speckled Mug",
      desc: "Thrown + trimmed · Celadon glaze",
      app: "Pottery",
    },
  ];
  const p = pieces[piece % pieces.length];
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-yellow-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Random piece
        </span>
        <button
          onClick={() => setPiece((x) => x + 1)}
          className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onExpand}
          className="p-1 rounded hover:bg-muted text-muted-foreground"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="bg-muted/40 rounded-xl overflow-hidden">
        <div className="h-32 bg-gradient-to-br from-amber-50 to-stone-100 dark:from-amber-900/20 dark:to-stone-800/20 flex items-center justify-center">
          <span className="text-muted-foreground/30 text-sm">
            Collection photo
          </span>
        </div>
        <div className="p-3">
          <div className="text-sm font-semibold">{p.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{p.desc}</div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs bg-background px-2 py-0.5 rounded border border-border">
              {p.app}
            </span>
            <a
              href="#"
              className="text-xs text-primary hover:underline flex items-center gap-0.5"
            >
              View <ArrowRight className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FocusCards() {
  const [dark, setDark] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedWidget, setExpandedWidget] = useState<WidgetId | null>(null);
  const [activeWidgets, setActiveWidgets] = useState<WidgetId[]>([
    "pottery",
    "quilting",
    "random",
    "activity",
    "shopping",
    "weather",
  ]);

  function removeWidget(id: WidgetId) {
    setActiveWidgets((w) => w.filter((x) => x !== id));
  }

  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-background text-foreground font-sans flex">
        {/* Left sidebar */}
        <aside
          className={`flex-shrink-0 border-r border-border flex flex-col transition-all duration-200 ${collapsed ? "w-14" : "w-52"}`}
        >
          {/* Logo */}
          <div className="p-3 border-b border-border flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center flex-shrink-0">
              <LayoutGrid className="w-4 h-4 text-background" />
            </div>
            {!collapsed && <span className="font-bold text-sm">Batchelor</span>}
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground"
            >
              {collapsed ? (
                <ChevronsRight className="w-3.5 h-3.5" />
              ) : (
                <ChevronsLeft className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 p-2 space-y-0.5">
            {NAV.map((item) => (
              <button
                key={item.label}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${item.active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" />
                {!collapsed && item.label}
              </button>
            ))}
          </nav>

          {/* User */}
          <div className="p-3 border-t border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold flex-shrink-0">
                SC
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">Sarah</div>
                  <div className="text-xs text-muted-foreground truncate">
                    sarah@studio.co
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Main area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <header className="border-b border-border px-5 py-3 flex items-center gap-3">
            <button className="flex items-center gap-2 text-sm text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors flex-1 max-w-xs">
              <Search className="w-3.5 h-3.5 flex-shrink-0" /> Search
              everything...
            </button>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => setDark((d) => !d)}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
              >
                {dark ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </button>
              <button className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-y-auto p-5">
            <div className="mb-5">
              <h1 className="text-xl font-bold">Good morning, Sarah.</h1>
              <p className="text-sm text-muted-foreground">
                One account, every collection.
              </p>
            </div>

            <div className="space-y-3 max-w-2xl">
              {/* Pottery widget */}
              {activeWidgets.includes("pottery") && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <button
                    onClick={() =>
                      setExpandedWidget(
                        expandedWidget === "pottery" ? null : "pottery",
                      )
                    }
                    className="w-full flex items-center gap-3 p-4 hover:bg-muted/40 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                      <Package className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="flex-1 text-left">
                      <div className="text-sm font-semibold">
                        Pottery collection
                      </div>
                      <div className="text-xs text-muted-foreground">
                        163 pieces · 12 categories
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-bold">163</span>
                      <ChevronDown
                        className={`w-4 h-4 text-muted-foreground transition-transform ${expandedWidget === "pottery" ? "rotate-180" : ""}`}
                      />
                    </div>
                  </button>
                  {expandedWidget === "pottery" && (
                    <div className="px-4 pb-4 border-t border-border">
                      <div className="grid grid-cols-3 gap-3 pt-4 mb-4">
                        {[
                          { v: "163", l: "Total" },
                          { v: "158", l: "Unique" },
                          { v: "12", l: "Categories" },
                        ].map((s) => (
                          <div
                            key={s.l}
                            className="bg-muted/50 rounded-lg p-3 text-center"
                          >
                            <div className="text-xl font-bold">{s.v}</div>
                            <div className="text-xs text-muted-foreground">
                              {s.l}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-1.5">
                        {[
                          "Blue celadon bowl · Added 2 days ago",
                          "Raku-fired vase · Added last week",
                          "Speckled mug · Added last week",
                        ].map((item, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                          >
                            <div className="w-8 h-8 rounded bg-amber-100 dark:bg-amber-900/30 flex-shrink-0" />
                            <span className="text-sm text-muted-foreground flex-1">
                              {item}
                            </span>
                            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/50" />
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <a
                          href="#"
                          className="text-xs font-medium text-primary hover:underline flex items-center gap-0.5"
                        >
                          Open collection <ArrowRight className="w-3 h-3" />
                        </a>
                        <button
                          onClick={() => removeWidget("pottery")}
                          className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-0.5"
                        >
                          <X className="w-3 h-3" /> Remove widget
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Quilting widget */}
              {activeWidgets.includes("quilting") && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <button
                    onClick={() =>
                      setExpandedWidget(
                        expandedWidget === "quilting" ? null : "quilting",
                      )
                    }
                    className="w-full flex items-center gap-3 p-4 hover:bg-muted/40 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center flex-shrink-0">
                      <Shirt className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div className="flex-1 text-left">
                      <div className="text-sm font-semibold">Quilting</div>
                      <div className="text-xs text-muted-foreground">
                        46 fabrics · 13 blocks · 1 layout
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-2xl font-bold">46</div>
                        <div className="text-xs text-muted-foreground -mt-0.5">
                          fabrics
                        </div>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-muted-foreground transition-transform ${expandedWidget === "quilting" ? "rotate-180" : ""}`}
                      />
                    </div>
                  </button>
                  {expandedWidget === "quilting" && (
                    <div className="px-4 pb-4 border-t border-border">
                      <div className="grid grid-cols-3 gap-3 pt-4 mb-4">
                        {[
                          { v: "46", l: "Fabrics" },
                          { v: "13", l: "Blocks" },
                          { v: "1", l: "Layouts" },
                        ].map((s) => (
                          <div
                            key={s.l}
                            className="bg-muted/50 rounded-lg p-3 text-center"
                          >
                            <div className="text-xl font-bold">{s.v}</div>
                            <div className="text-xs text-muted-foreground">
                              {s.l}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="bg-muted/30 rounded-lg p-3 mb-3">
                        <div className="text-xs font-medium text-muted-foreground mb-2">
                          Shopping list (3 items)
                        </div>
                        {[
                          "Kona Cotton — Navy · 2 yds",
                          "Batting (queen) · ordered",
                          "Teal stripe · 1.5 yds",
                        ].map((i, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-2 py-1"
                          >
                            <div
                              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${idx === 1 ? "bg-emerald-400" : "bg-rose-400"}`}
                            />
                            <span className="text-sm text-muted-foreground">
                              {i}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between">
                        <a
                          href="#"
                          className="text-xs font-medium text-primary hover:underline flex items-center gap-0.5"
                        >
                          Open quilting <ArrowRight className="w-3 h-3" />
                        </a>
                        <button
                          onClick={() => removeWidget("quilting")}
                          className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-0.5"
                        >
                          <X className="w-3 h-3" /> Remove widget
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Random piece */}
              {activeWidgets.includes("random") && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <RandomPieceWidget
                    onExpand={() => setExpandedWidget("random")}
                  />
                </div>
              )}

              {/* Activity feed */}
              {activeWidgets.includes("activity") && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Recent activity
                    </span>
                    <button
                      onClick={() => removeWidget("activity")}
                      className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="space-y-1">
                    {[
                      {
                        l: "Added 'Speckled Mug'",
                        app: "Pottery",
                        t: "2h ago",
                        c: "amber",
                      },
                      {
                        l: "Updated fabric stash",
                        app: "Quilting",
                        t: "Yesterday",
                        c: "violet",
                      },
                      {
                        l: "Created 'Bear Claw' block",
                        app: "Quilting",
                        t: "2 days ago",
                        c: "violet",
                      },
                      {
                        l: "Added 'Serving bowl'",
                        app: "Pottery",
                        t: "3 days ago",
                        c: "amber",
                      },
                    ].map((item, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.c === "amber" ? "bg-amber-400" : "bg-violet-400"}`}
                        />
                        <span className="flex-1 text-sm">{item.l}</span>
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {item.t}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add widget button */}
              <button className="w-full border-2 border-dashed border-border rounded-xl py-4 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-muted/20 transition-colors">
                <Plus className="w-4 h-4" /> Add widget
              </button>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
