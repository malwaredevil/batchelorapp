import { ArrowLeft, Save, Download, Paintbrush, Eraser, PaintBucket, Pipette, Hand, ZoomIn, ZoomOut, Scissors, RotateCcw, RotateCw, ChevronRight } from "lucide-react";

function StatusBar() {
  return (
    <div className="flex items-center justify-between bg-slate-900 px-5 shrink-0" style={{ height: 28 }}>
      <span className="text-white text-[11px] font-semibold tracking-wide">12:48</span>
      <div className="flex items-center gap-1.5">
        <div className="flex gap-[2px] items-end h-3">
          {[3,4,5,6].map((h,i) => <div key={i} style={{height:`${h*2}px`}} className="w-[3px] bg-white rounded-sm"/>)}
        </div>
        <svg width="14" height="10" viewBox="0 0 14 10" fill="white"><rect x="0" y="0" width="12" height="10" rx="2" stroke="white" strokeWidth="1" fill="none"/><rect x="1" y="1" width="8" height="8" rx="1" fill="white"/><rect x="12.5" y="3" width="1.5" height="4" rx="0.5" fill="white"/></svg>
      </div>
    </div>
  );
}

// A simple 8×8 block grid with some fabric colors painted in
const GRID = 8;
const palette = [
  "#2D4A6B","#6B9AC4","#A8C5E2","#7B4F2E","#D4956A","#2E7D4F","#82C99A","#B5526B","#F0A0B4","#8B7500","#FFD966","#4A235A","#C39BD3","#FDFEFE","#1A1A2E",
];
const cellColors: Record<string, string> = {
  "0,0":"#2D4A6B","0,1":"#2D4A6B","0,2":"#6B9AC4","0,3":"#6B9AC4","0,4":"#2D4A6B","0,5":"#2D4A6B","0,6":"#6B9AC4","0,7":"#6B9AC4",
  "1,0":"#2D4A6B","1,1":"#A8C5E2","1,2":"#A8C5E2","1,3":"#6B9AC4","1,4":"#2D4A6B","1,5":"#A8C5E2","1,6":"#A8C5E2","1,7":"#6B9AC4",
  "2,0":"#6B9AC4","2,1":"#A8C5E2","2,2":"#FDFEFE","2,3":"#FDFEFE","2,4":"#6B9AC4","2,5":"#A8C5E2","2,6":"#FDFEFE","2,7":"#FDFEFE",
  "3,0":"#6B9AC4","3,1":"#6B9AC4","3,2":"#FDFEFE","3,3":"#B5526B","3,4":"#6B9AC4","3,5":"#6B9AC4","3,6":"#FDFEFE","3,7":"#B5526B",
  "4,0":"#2D4A6B","4,1":"#2D4A6B","4,2":"#6B9AC4","4,3":"#6B9AC4","4,4":"#2D4A6B","4,5":"#2D4A6B","4,6":"#6B9AC4","4,7":"#6B9AC4",
  "5,0":"#2D4A6B","5,1":"#A8C5E2","5,2":"#A8C5E2","5,3":"#6B9AC4","5,4":"#2D4A6B","5,5":"#A8C5E2","5,6":"#A8C5E2","5,7":"#6B9AC4",
  "6,0":"#6B9AC4","6,1":"#A8C5E2","6,2":"#FDFEFE","6,3":"#FDFEFE","6,4":"#6B9AC4","6,5":"#A8C5E2","6,6":"#FDFEFE","6,7":"#FDFEFE",
  "7,0":"#6B9AC4","7,1":"#6B9AC4","7,2":"#FDFEFE","7,3":"#B5526B","7,4":"#6B9AC4","7,5":"#6B9AC4","7,6":"#FDFEFE","7,7":"#B5526B",
};

const tools = [
  { id: "paint", Icon: Paintbrush },
  { id: "bucket", Icon: PaintBucket },
  { id: "pick", Icon: Pipette },
  { id: "erase", Icon: Eraser },
  { id: "cut", Icon: Scissors },
  { id: "hand", Icon: Hand },
];

export function BlockDesigner() {
  return (
    <div className="flex flex-col w-full h-screen bg-slate-100 overflow-hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <StatusBar />

      {/* Header */}
      <div className="bg-slate-900 flex items-center justify-between px-3 py-2 shrink-0">
        <button className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
          <ArrowLeft size={16} className="text-white" />
        </button>
        <div className="text-center">
          <p className="text-white text-[13px] font-semibold">Star Block</p>
          <p className="text-slate-400 text-[10px]">8×8 grid · 12"</p>
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

      {/* Main canvas area */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left tool strip */}
        <div className="bg-slate-800 w-12 flex flex-col items-center py-3 gap-2 shrink-0">
          {tools.map(({ id, Icon }, i) => (
            <button key={id} className={`w-9 h-9 rounded-xl flex items-center justify-center ${i === 0 ? "bg-teal-500" : "bg-white/10"}`}>
              <Icon size={16} className="text-white" />
            </button>
          ))}
          <div className="flex-1" />
          <button className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
            <RotateCcw size={14} className="text-slate-300" />
          </button>
          <button className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
            <RotateCw size={14} className="text-slate-300" />
          </button>
        </div>

        {/* Canvas + right panel */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Block canvas */}
          <div className="flex-1 flex items-center justify-center bg-slate-200 p-2">
            <div className="border border-slate-400 shadow-lg bg-white" style={{ display: "grid", gridTemplateColumns: `repeat(${GRID}, 1fr)`, width: 240, height: 240 }}>
              {Array.from({ length: GRID }).map((_, r) =>
                Array.from({ length: GRID }).map((_, c) => (
                  <div
                    key={`${r},${c}`}
                    style={{ backgroundColor: cellColors[`${r},${c}`] ?? "#FDFEFE", borderRight: "0.5px solid rgba(0,0,0,0.08)", borderBottom: "0.5px solid rgba(0,0,0,0.08)" }}
                  />
                ))
              )}
            </div>
          </div>

          {/* Zoom controls */}
          <div className="bg-slate-800 flex items-center justify-between px-3 py-1.5 shrink-0">
            <button className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center">
              <ZoomOut size={13} className="text-slate-300" />
            </button>
            <span className="text-white text-[11px] font-medium">100%</span>
            <button className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center">
              <ZoomIn size={13} className="text-slate-300" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom fabric palette */}
      <div className="bg-slate-900 px-3 pt-2 pb-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-slate-400 text-[10px] font-semibold uppercase tracking-widest">Fabric Palette</span>
          <button className="flex items-center gap-0.5 text-teal-400 text-[10px]">Add fabric <ChevronRight size={10} /></button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {palette.map((c, i) => (
            <button
              key={c}
              style={{ backgroundColor: c }}
              className={`shrink-0 w-8 h-8 rounded-lg border-2 ${i === 0 ? "border-teal-400 scale-110" : "border-transparent"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
