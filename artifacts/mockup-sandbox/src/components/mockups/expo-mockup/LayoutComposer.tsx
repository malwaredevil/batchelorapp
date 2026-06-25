import { ArrowLeft, Save, Download, RotateCw, Sliders, Grid3X3, Plus } from "lucide-react";

function StatusBar() {
  return (
    <div className="flex items-center justify-between bg-slate-900 px-5 shrink-0" style={{ height: 28 }}>
      <span className="text-white text-[11px] font-semibold tracking-wide">12:49</span>
      <div className="flex items-center gap-1.5">
        <div className="flex gap-[2px] items-end h-3">
          {[3,4,5,6].map((h,i) => <div key={i} style={{height:`${h*2}px`}} className="w-[3px] bg-white rounded-sm"/>)}
        </div>
        <svg width="14" height="10" viewBox="0 0 14 10" fill="white"><rect x="0" y="0" width="12" height="10" rx="2" stroke="white" strokeWidth="1" fill="none"/><rect x="1" y="1" width="8" height="8" rx="1" fill="white"/><rect x="12.5" y="3" width="1.5" height="4" rx="0.5" fill="white"/></svg>
      </div>
    </div>
  );
}

// Layout: 5×6 grid of blocks, each block has a mini color pattern
const COLS = 5;
const ROWS = 6;
// Alternating block patterns for visual interest
const blockPatterns = [
  ["#2D4A6B","#FDFEFE","#2D4A6B","#FDFEFE"],
  ["#6B9AC4","#A8C5E2","#6B9AC4","#A8C5E2"],
  ["#B5526B","#F0A0B4","#B5526B","#F0A0B4"],
  ["#2E7D4F","#82C99A","#2E7D4F","#82C99A"],
  ["#7B4F2E","#D4956A","#7B4F2E","#D4956A"],
];

function MiniBlock({ pattern, selected }: { pattern: string[]; selected?: boolean }) {
  return (
    <div className={`w-full aspect-square border rounded-sm overflow-hidden ${selected ? "border-teal-400 shadow-sm" : "border-slate-300"}`}
      style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
      {pattern.map((c, i) => <div key={i} style={{ backgroundColor: c }} />)}
    </div>
  );
}

const blocks = [
  { id: "ohio-star", name: "Ohio Star", pattern: ["#2D4A6B","#FDFEFE","#FDFEFE","#2D4A6B"] },
  { id: "log-cabin", name: "Log Cabin", pattern: ["#B5526B","#F0A0B4","#F0A0B4","#B5526B"] },
  { id: "pinwheel", name: "Pinwheel", pattern: ["#2E7D4F","#82C99A","#82C99A","#2E7D4F"] },
];

export function LayoutComposer() {
  return (
    <div className="flex flex-col w-full h-screen bg-slate-100 overflow-hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <StatusBar />

      {/* Header */}
      <div className="bg-slate-900 flex items-center justify-between px-3 py-2 shrink-0">
        <button className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
          <ArrowLeft size={16} className="text-white" />
        </button>
        <div className="text-center">
          <p className="text-white text-[13px] font-semibold">Garden Dreams Quilt</p>
          <p className="text-slate-400 text-[10px]">5×6 · 60"×72"</p>
        </div>
        <div className="flex gap-1.5">
          <button className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
            <Download size={14} className="text-slate-300" />
          </button>
          <button className="w-8 h-8 rounded-lg bg-teal-500 flex items-center justify-center">
            <Save size={14} className="text-white" />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-slate-800 flex items-center gap-2 px-3 py-1.5 shrink-0">
        {[
          { Icon: Grid3X3, label: "Layout" },
          { Icon: Sliders, label: "Settings" },
          { Icon: RotateCw, label: "Rotate" },
        ].map(({ Icon, label }, i) => (
          <button key={label} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium ${i === 0 ? "bg-teal-600 text-white" : "bg-white/10 text-slate-300"}`}>
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* Main area: quilt grid + block picker */}
      <div className="flex flex-1 overflow-hidden">
        {/* Quilt grid */}
        <div className="flex-1 flex items-center justify-center bg-slate-200 p-3">
          <div className="bg-white p-1.5 shadow-lg rounded-lg border border-slate-300">
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 3, width: 230 }}>
              {Array.from({ length: ROWS * COLS }).map((_, i) => {
                const patIdx = Math.floor(i / COLS + i) % blockPatterns.length;
                const isSelected = i === 7;
                return (
                  <MiniBlock
                    key={i}
                    pattern={blockPatterns[patIdx]}
                    selected={isSelected}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Right block picker panel */}
        <div className="w-24 bg-slate-900 flex flex-col shrink-0 overflow-hidden">
          <div className="px-2 pt-2 pb-1">
            <p className="text-slate-400 text-[9px] font-semibold uppercase tracking-widest">Blocks</p>
          </div>
          <div className="flex-1 overflow-y-auto px-2 space-y-2 pb-2">
            {blocks.map((b) => (
              <button key={b.id} className="w-full">
                <div className={`w-full aspect-square border-2 rounded-lg overflow-hidden ${b.id === "ohio-star" ? "border-teal-400" : "border-transparent"}`}
                  style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                  {b.pattern.map((c, i) => <div key={i} style={{ backgroundColor: c }} />)}
                </div>
                <p className="text-[8px] text-slate-400 mt-0.5 text-center leading-tight">{b.name}</p>
              </button>
            ))}
            <button className="w-full aspect-square border-2 border-dashed border-slate-600 rounded-lg flex items-center justify-center">
              <Plus size={14} className="text-slate-500" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom: fabric strip */}
      <div className="bg-slate-900 px-3 pt-1.5 pb-2.5 shrink-0">
        <p className="text-slate-400 text-[9px] font-semibold uppercase tracking-widest mb-1.5">Fabrics in layout</p>
        <div className="flex gap-1.5">
          {["#2D4A6B","#6B9AC4","#A8C5E2","#B5526B","#F0A0B4","#2E7D4F","#82C99A","#7B4F2E"].map((c) => (
            <div key={c} className="w-7 h-7 rounded-lg shrink-0 border border-white/10" style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>
    </div>
  );
}
