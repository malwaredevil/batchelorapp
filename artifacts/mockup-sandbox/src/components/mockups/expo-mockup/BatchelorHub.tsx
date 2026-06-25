import { Grid3X3, Scissors, Sun, Moon, Search, Plus, ChevronRight, Package, Camera, Layers, ShoppingCart, LayoutGrid, Activity, Settings } from "lucide-react";

function StatusBar() {
  return (
    <div className="flex items-center justify-between px-5 shrink-0 bg-slate-900" style={{ height: 28 }}>
      <span className="text-white text-[11px] font-semibold tracking-wide">12:44</span>
      <div className="flex items-center gap-1.5">
        <div className="flex gap-[2px] items-end h-3">
          {[3,4,5,6].map((h,i) => <div key={i} style={{height:`${h*2}px`}} className="w-[3px] bg-white rounded-sm"/>)}
        </div>
        <svg width="14" height="10" viewBox="0 0 14 10" fill="white"><rect x="0" y="0" width="12" height="10" rx="2" stroke="white" strokeWidth="1" fill="none"/><rect x="1" y="1" width="8" height="8" rx="1" fill="white"/><rect x="12.5" y="3" width="1.5" height="4" rx="0.5" fill="white"/></svg>
      </div>
    </div>
  );
}

export function BatchelorHub() {
  return (
    <div className="flex flex-col w-full h-screen bg-slate-950 overflow-hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <StatusBar />

      {/* Header */}
      <div className="px-5 pt-4 pb-3 shrink-0 bg-slate-950">
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-slate-500 text-[11px] font-medium uppercase tracking-widest">Welcome back</p>
            <h1 className="text-[24px] font-bold text-white leading-tight">Ashley's Studio</h1>
          </div>
          <div className="flex gap-2">
            <button className="w-9 h-9 rounded-full bg-white/8 flex items-center justify-center">
              <Search size={17} className="text-slate-300" />
            </button>
            <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center">
              <span className="text-white text-[13px] font-bold">AB</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">

        {/* Two main app cards */}
        <div className="space-y-3">
          {/* Pottery card */}
          <button className="w-full rounded-3xl overflow-hidden relative" style={{ height: 140 }}>
            <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #1C1007 0%, #7B3F00 40%, #D97706 100%)" }} />
            <div className="absolute inset-0 flex items-end p-4">
              <div className="flex-1 text-left">
                <p className="text-amber-200 text-[11px] font-semibold uppercase tracking-widest">Collection</p>
                <h2 className="text-white text-[20px] font-bold leading-tight">My Pottery</h2>
                <p className="text-amber-400 text-[12px] mt-0.5">163 pieces catalogued</p>
              </div>
              <div className="text-right">
                <span style={{ fontSize: 52 }}>🏺</span>
              </div>
            </div>
            <div className="absolute top-3 right-3 bg-white/15 backdrop-blur-sm rounded-full p-1.5">
              <ChevronRight size={14} className="text-white" />
            </div>
          </button>

          {/* Quilting card */}
          <button className="w-full rounded-3xl overflow-hidden relative" style={{ height: 140 }}>
            <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #0C1A0C 0%, #1A5C2A 40%, #16A34A 100%)" }} />
            <div className="absolute inset-0 flex items-end p-4">
              <div className="flex-1 text-left">
                <p className="text-emerald-200 text-[11px] font-semibold uppercase tracking-widest">Studio</p>
                <h2 className="text-white text-[20px] font-bold leading-tight">My Quilting</h2>
                <p className="text-emerald-400 text-[12px] mt-0.5">46 fabrics · 1 quilt in progress</p>
              </div>
              <div className="text-right">
                <span style={{ fontSize: 52 }}>🧵</span>
              </div>
            </div>
            <div className="absolute top-3 right-3 bg-white/15 backdrop-blur-sm rounded-full p-1.5">
              <ChevronRight size={14} className="text-white" />
            </div>
          </button>
        </div>

        {/* Quick add row */}
        <div>
          <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-widest mb-2">Quick Add</p>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Pottery\nPiece", Icon: Package, color: "#D97706", bg: "rgba(217,119,6,0.15)" },
              { label: "Fabric", Icon: Scissors, color: "#16A34A", bg: "rgba(22,163,74,0.15)" },
              { label: "Pattern", Icon: Layers, color: "#2563EB", bg: "rgba(37,99,235,0.15)" },
              { label: "Quilt", Icon: LayoutGrid, color: "#9333EA", bg: "rgba(147,51,234,0.15)" },
            ].map(({ label, Icon, color, bg }) => (
              <button key={label} className="flex flex-col items-center gap-1.5 rounded-2xl py-3 px-1" style={{ backgroundColor: bg }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${color}33` }}>
                  <Icon size={18} style={{ color }} />
                </div>
                <span className="text-[10px] text-slate-300 font-medium text-center leading-tight whitespace-pre-line">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-widest">Recent Activity</p>
            <button className="text-slate-500 text-[11px]">See all</button>
          </div>
          <div className="space-y-2">
            {[
              { icon: "🏺", label: "Added Celadon Bowl", sub: "Pottery · 2 hours ago", color: "#D97706" },
              { icon: "🌸", label: "3 fabrics bulk-added", sub: "Quilting · Yesterday", color: "#16A34A" },
              { icon: "🧵", label: "Garden Dreams layout saved", sub: "Quilting · 2 days ago", color: "#2563EB" },
            ].map(({ icon, label, sub, color }) => (
              <div key={label} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 bg-white/5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ backgroundColor: `${color}22` }}>
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-slate-200 truncate">{label}</p>
                  <p className="text-[11px] text-slate-500">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { value: "163", label: "Pottery\nPieces" },
            { value: "46", label: "Fabric\nSwatches" },
            { value: "13", label: "Block\nPatterns" },
          ].map(({ value, label }) => (
            <div key={label} className="rounded-2xl py-3 px-2 text-center bg-white/5">
              <p className="text-[22px] font-bold text-white">{value}</p>
              <p className="text-[10px] text-slate-500 leading-tight whitespace-pre-line mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
