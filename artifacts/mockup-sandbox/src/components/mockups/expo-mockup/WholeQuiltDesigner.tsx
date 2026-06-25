import { ArrowLeft, Save, Download, Paintbrush, Eraser, PaintBucket, Eye, Wand2, GripVertical, ChevronDown } from "lucide-react";

function StatusBar() {
  return (
    <div className="flex items-center justify-between bg-slate-900 px-5 shrink-0" style={{ height: 28 }}>
      <span className="text-white text-[11px] font-semibold tracking-wide">12:50</span>
      <div className="flex items-center gap-1.5">
        <div className="flex gap-[2px] items-end h-3">
          {[3,4,5,6].map((h,i) => <div key={i} style={{height:`${h*2}px`}} className="w-[3px] bg-white rounded-sm"/>)}
        </div>
        <svg width="14" height="10" viewBox="0 0 14 10" fill="white"><rect x="0" y="0" width="12" height="10" rx="2" stroke="white" strokeWidth="1" fill="none"/><rect x="1" y="1" width="8" height="8" rx="1" fill="white"/><rect x="12.5" y="3" width="1.5" height="4" rx="0.5" fill="white"/></svg>
      </div>
    </div>
  );
}

// 6×8 whole quilt grid — each cell is a quadrant pair of colors
const COLS = 6;
const ROWS = 8;
const fabricColors = [
  "#2D4A6B","#6B9AC4","#A8C5E2","#FDFEFE",
  "#B5526B","#F0A0B4","#2E7D4F","#82C99A",
  "#7B4F2E","#D4956A","#FFD966","#4A235A",
];
// Simulate a patchwork layout
function cellFill(r: number, c: number): [string, string] {
  const idx = (r * 3 + c * 2) % fabricColors.length;
  const idx2 = (r * 2 + c * 3 + 4) % fabricColors.length;
  return [fabricColors[idx], fabricColors[idx2]];
}

export function WholeQuiltDesigner() {
  return (
    <div className="flex flex-col w-full h-screen bg-slate-900 overflow-hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <StatusBar />

      {/* Header */}
      <div className="bg-slate-900 flex items-center justify-between px-3 py-2 shrink-0 border-b border-slate-700">
        <button className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
          <ArrowLeft size={16} className="text-white" />
        </button>
        <div className="text-center">
          <p className="text-white text-[13px] font-semibold">Garden Dreams Quilt</p>
          <p className="text-slate-400 text-[10px]">Whole Quilt View · 60"×80"</p>
        </div>
        <div className="flex gap-1.5">
          <button className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
            <Eye size={14} className="text-slate-300" />
          </button>
          <button className="w-8 h-8 rounded-lg bg-teal-500 flex items-center justify-center">
            <Save size={14} className="text-white" />
          </button>
        </div>
      </div>

      {/* Tool strip */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 shrink-0">
        {[
          { Icon: Paintbrush, active: true },
          { Icon: PaintBucket, active: false },
          { Icon: Eraser, active: false },
          { Icon: Wand2, active: false },
        ].map(({ Icon, active }, i) => (
          <button key={i} className={`w-9 h-9 rounded-xl flex items-center justify-center ${active ? "bg-teal-500" : "bg-white/10"}`}>
            <Icon size={16} className="text-white" />
          </button>
        ))}
        <div className="flex-1" />
        <button className="flex items-center gap-1 bg-white/10 rounded-lg px-2.5 py-1.5">
          <Download size={13} className="text-slate-300" />
          <span className="text-slate-300 text-[11px]">Export</span>
        </button>
      </div>

      {/* Main canvas */}
      <div className="flex flex-1 overflow-hidden">

        {/* Layer / fabric picker strip (left) */}
        <div className="w-14 bg-slate-900 flex flex-col items-center py-2 gap-1.5 shrink-0 border-r border-slate-700 overflow-y-auto">
          <p className="text-[8px] text-slate-500 uppercase tracking-widest mb-1">Fabrics</p>
          {fabricColors.map((c, i) => (
            <button
              key={c}
              style={{ backgroundColor: c }}
              className={`w-8 h-8 rounded-lg border-2 shrink-0 ${i === 0 ? "border-teal-400 scale-110" : "border-transparent"}`}
            />
          ))}
        </div>

        {/* Quilt canvas */}
        <div className="flex-1 flex items-center justify-center bg-slate-950 p-2">
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 2, width: 270 }}>
            {Array.from({ length: ROWS * COLS }).map((_, i) => {
              const r = Math.floor(i / COLS);
              const c = i % COLS;
              const [a, b] = cellFill(r, c);
              return (
                <div
                  key={i}
                  className="rounded-sm overflow-hidden"
                  style={{
                    width: "100%",
                    aspectRatio: "1",
                    background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)`,
                    border: "0.5px solid rgba(255,255,255,0.05)"
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom: layer list */}
      <div className="bg-slate-800 px-3 py-2 shrink-0 border-t border-slate-700">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-slate-400 text-[9px] font-semibold uppercase tracking-widest">Layers</p>
          <button className="text-teal-400 text-[9px]">+ Add</button>
        </div>
        <div className="space-y-1">
          {["Backing fabric","Batting","Quilt top","Border"].map((name, i) => (
            <div key={name} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${i === 2 ? "bg-teal-900/40" : "bg-white/5"}`}>
              <GripVertical size={10} className="text-slate-500 shrink-0" />
              <div className="w-4 h-4 rounded shrink-0" style={{ backgroundColor: fabricColors[i * 3] }} />
              <span className={`text-[11px] flex-1 ${i === 2 ? "text-teal-300 font-medium" : "text-slate-400"}`}>{name}</span>
              <Eye size={10} className="text-slate-500" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
