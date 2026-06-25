import {
  Search,
  Camera,
  Grid3X3,
  Layers,
  ShoppingCart,
  Settings,
  Plus,
  Star,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";

const STATUS_BAR_H = 28;

const fabrics = [
  { id: 1, name: "Midnight Florals", color: "#2D4A6B", accent: "#6B9AC4", yardage: "2.5 yds", type: "Cotton", emoji: "🌸" },
  { id: 2, name: "Warm Plaid", color: "#7B4F2E", accent: "#D4956A", yardage: "1.0 yd", type: "Flannel", emoji: "🟫" },
  { id: 3, name: "Ocean Dots", color: "#1A5276", accent: "#85C1E9", yardage: "3.0 yds", type: "Cotton", emoji: "🔵" },
  { id: 4, name: "Sage Leaves", color: "#2E7D4F", accent: "#82C99A", yardage: "0.5 yd", type: "Linen", emoji: "🌿" },
  { id: 5, name: "Blush Stripes", color: "#B5526B", accent: "#F0A0B4", yardage: "4.0 yds", type: "Voile", emoji: "🩷" },
  { id: 6, name: "Butter Gingham", color: "#8B7500", accent: "#FFD966", yardage: "2.0 yds", type: "Cotton", emoji: "🟡" },
];

function StatusBar() {
  return (
    <div
      style={{ height: STATUS_BAR_H }}
      className="flex items-center justify-between bg-slate-900 px-5 shrink-0"
    >
      <span className="text-white text-[11px] font-semibold tracking-wide">12:45</span>
      <div className="flex items-center gap-1.5">
        <div className="flex gap-[2px] items-end h-3">
          {[3, 4, 5, 6].map((h, i) => (
            <div key={i} style={{ height: `${h * 2}px` }} className="w-[3px] bg-white rounded-sm" />
          ))}
        </div>
        <svg width="14" height="10" viewBox="0 0 14 10" fill="white">
          <rect x="0" y="0" width="12" height="10" rx="2" stroke="white" strokeWidth="1" fill="none"/>
          <rect x="1" y="1" width="8" height="8" rx="1" fill="white"/>
          <rect x="12.5" y="3" width="1.5" height="4" rx="0.5" fill="white"/>
        </svg>
      </div>
    </div>
  );
}

function BottomTabBar({ active = "fabrics" }: { active?: string }) {
  const tabs = [
    { id: "fabrics", label: "Fabrics", icon: Grid3X3 },
    { id: "patterns", label: "Patterns", icon: Layers },
    { id: "quilts", label: "Quilts", icon: Star },
    { id: "shopping", label: "Shopping", icon: ShoppingCart },
    { id: "settings", label: "Settings", icon: Settings },
  ];
  return (
    <div className="flex items-center bg-white border-t border-slate-200 shrink-0" style={{ height: 60, paddingBottom: 4 }}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = t.id === active;
        return (
          <div key={t.id} className="flex-1 flex flex-col items-center justify-center gap-0.5 pt-1">
            <Icon
              size={22}
              className={isActive ? "text-teal-600" : "text-slate-400"}
              strokeWidth={isActive ? 2.5 : 1.8}
            />
            <span
              className={`text-[10px] font-medium ${isActive ? "text-teal-600" : "text-slate-400"}`}
            >
              {t.label}
            </span>
            {isActive && (
              <div className="absolute bottom-[56px] h-0.5 w-10 bg-teal-600 rounded-full" style={{ position: "static", marginTop: -4 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function FabricsList() {
  return (
    <div className="flex flex-col w-full h-screen bg-slate-50 overflow-hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <StatusBar />

      {/* App Bar */}
      <div className="bg-white px-4 pt-3 pb-2 shadow-sm shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[11px] text-slate-400 font-medium uppercase tracking-widest">Ashley's Quilting</p>
            <h1 className="text-[22px] font-bold text-slate-800 leading-tight">My Fabrics</h1>
          </div>
          <div className="flex items-center gap-2">
            <button className="w-9 h-9 rounded-full bg-teal-50 flex items-center justify-center">
              <Camera size={18} className="text-teal-600" strokeWidth={2} />
            </button>
            <button className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">
              <Search size={18} className="text-slate-600" strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {["All (46)", "Cotton", "Flannel", "Linen", "Voile"].map((chip, i) => (
            <button
              key={chip}
              className={`shrink-0 px-3 py-1 rounded-full text-[12px] font-medium border ${
                i === 0
                  ? "bg-teal-600 text-white border-teal-600"
                  : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              {chip}
            </button>
          ))}
          <button className="shrink-0 w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
            <SlidersHorizontal size={13} className="text-slate-600" />
          </button>
        </div>
      </div>

      {/* Sort row */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0">
        <span className="text-[12px] text-slate-400">46 fabrics</span>
        <button className="flex items-center gap-1 text-[12px] text-teal-600 font-medium">
          Newest first <ChevronDown size={13} />
        </button>
      </div>

      {/* Fabric grid */}
      <div className="flex-1 overflow-y-auto px-3 pb-2">
        <div className="grid grid-cols-2 gap-3">
          {fabrics.map((f) => (
            <div
              key={f.id}
              className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100 active:scale-95 transition-transform"
            >
              {/* Swatch */}
              <div
                className="h-28 flex items-center justify-center relative"
                style={{ background: `linear-gradient(135deg, ${f.color} 0%, ${f.accent} 100%)` }}
              >
                <span className="text-5xl">{f.emoji}</span>
                <div className="absolute top-2 right-2 bg-white/20 backdrop-blur-sm rounded-full px-1.5 py-0.5">
                  <span className="text-[9px] text-white font-semibold">{f.type}</span>
                </div>
              </div>
              <div className="p-2.5">
                <p className="text-[13px] font-semibold text-slate-800 leading-tight truncate">{f.name}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{f.yardage}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* FAB */}
      <div className="absolute bottom-[72px] right-4">
        <button className="w-14 h-14 rounded-full bg-teal-600 shadow-lg flex items-center justify-center">
          <Plus size={26} className="text-white" strokeWidth={2.5} />
        </button>
      </div>

      <BottomTabBar active="fabrics" />
    </div>
  );
}
