import {
  ArrowLeft,
  Zap,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from "lucide-react";

const STATUS_BAR_H = 28;

const queue = [
  { id: "1", preview: "🌸", name: "Spring Florals", status: "done" },
  { id: "2", preview: "🔵", name: "Ocean Dots", status: "processing" },
  { id: "3", preview: "🟫", name: null, status: "queued" },
];

function StatusBar() {
  return (
    <div
      style={{ height: STATUS_BAR_H }}
      className="flex items-center justify-between px-5 shrink-0 absolute top-0 left-0 right-0 z-20"
    >
      <span className="text-white text-[11px] font-semibold tracking-wide drop-shadow">
        12:47
      </span>
      <div className="flex items-center gap-1.5">
        <div className="flex gap-[2px] items-end h-3">
          {[3, 4, 5, 6].map((h, i) => (
            <div
              key={i}
              style={{ height: `${h * 2}px` }}
              className="w-[3px] bg-white rounded-sm opacity-90"
            />
          ))}
        </div>
        <svg width="14" height="10" viewBox="0 0 14 10" fill="white">
          <rect
            x="0"
            y="0"
            width="12"
            height="10"
            rx="2"
            stroke="white"
            strokeWidth="1"
            fill="none"
          />
          <rect x="1" y="1" width="8" height="8" rx="1" fill="white" />
          <rect x="12.5" y="3" width="1.5" height="4" rx="0.5" fill="white" />
        </svg>
      </div>
    </div>
  );
}

export function BulkAdd() {
  return (
    <div
      className="flex flex-col w-full h-screen overflow-hidden relative"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* Camera viewfinder (full screen background) */}
      <div className="absolute inset-0 bg-slate-900">
        {/* Simulated camera feed */}
        <div
          className="absolute inset-0 opacity-60"
          style={{
            background:
              "linear-gradient(160deg, #1a2a1a 0%, #2d3b2d 30%, #1a1a2e 70%, #16213e 100%)",
          }}
        />
        {/* Grid overlay to suggest camera focus */}
        <div className="absolute inset-12 border border-white/10 rounded-2xl">
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
            {Array(9)
              .fill(0)
              .map((_, i) => (
                <div key={i} className="border border-white/5" />
              ))}
          </div>
        </div>

        {/* Corner brackets */}
        {[
          "top-10 left-10 border-l-2 border-t-2 rounded-tl-lg",
          "top-10 right-10 border-r-2 border-t-2 rounded-tr-lg",
          "bottom-44 left-10 border-l-2 border-b-2 rounded-bl-lg",
          "bottom-44 right-10 border-r-2 border-b-2 rounded-br-lg",
        ].map((cls, i) => (
          <div key={i} className={`absolute w-7 h-7 border-teal-400 ${cls}`} />
        ))}

        {/* AI scan line animation effect */}
        <div
          className="absolute left-10 right-10 top-[44%] h-px bg-teal-400/50"
          style={{ boxShadow: "0 0 8px 2px rgba(20,184,166,0.4)" }}
        />
      </div>

      <StatusBar />

      {/* Top bar (over camera) */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-10 pb-3">
        <button className="w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <ArrowLeft size={18} className="text-white" />
        </button>
        <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5">
          <Zap size={13} className="text-teal-400" fill="currentColor" />
          <span className="text-[12px] font-semibold text-white">
            AI Auto-Fill ON
          </span>
        </div>
        <div className="bg-teal-500 rounded-full px-2.5 py-1">
          <span className="text-[11px] font-bold text-white">3 captured</span>
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Processing queue sheet */}
      <div className="relative z-10 bg-slate-900/95 backdrop-blur-md rounded-t-3xl px-4 pt-4 pb-6">
        {/* Handle */}
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" />

        {/* Queue header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-white text-[15px] font-bold">Processing Queue</p>
            <p className="text-slate-400 text-[12px]">1 of 3 saved</p>
          </div>
          <button className="bg-teal-600 px-4 py-2 rounded-xl">
            <span className="text-white text-[13px] font-semibold">Done →</span>
          </button>
        </div>

        {/* Queue items */}
        <div className="space-y-2">
          {queue.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 bg-white/5 rounded-2xl px-3 py-2.5"
            >
              <div className="w-10 h-10 rounded-xl bg-slate-700 flex items-center justify-center text-2xl shrink-0">
                {item.preview}
              </div>
              <div className="flex-1 min-w-0">
                {item.status === "done" && (
                  <>
                    <p className="text-white text-[13px] font-medium truncate">
                      {item.name}
                    </p>
                    <p className="text-slate-400 text-[11px]">
                      Saved to collection
                    </p>
                  </>
                )}
                {item.status === "processing" && (
                  <>
                    <p className="text-slate-300 text-[13px] font-medium">
                      Analysing with AI…
                    </p>
                    <p className="text-teal-400 text-[11px]">
                      Filling in all details
                    </p>
                  </>
                )}
                {item.status === "queued" && (
                  <>
                    <p className="text-slate-400 text-[13px]">Queued</p>
                    <p className="text-slate-500 text-[11px]">
                      Waiting to upload
                    </p>
                  </>
                )}
              </div>
              {item.status === "done" && (
                <CheckCircle2 size={20} className="text-emerald-400 shrink-0" />
              )}
              {item.status === "processing" && (
                <Loader2
                  size={20}
                  className="text-teal-400 animate-spin shrink-0"
                />
              )}
              {item.status === "queued" && (
                <div className="w-5 h-5 rounded-full border-2 border-slate-600 shrink-0" />
              )}
            </div>
          ))}
        </div>

        {/* Shutter button row */}
        <div className="flex items-center justify-center mt-5">
          <button className="w-16 h-16 rounded-full bg-white border-4 border-slate-400 flex items-center justify-center shadow-lg active:scale-95 transition-transform">
            <div className="w-12 h-12 rounded-full bg-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
