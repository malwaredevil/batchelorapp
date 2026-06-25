import { ArrowLeft, ScanSearch, Camera, RotateCcw, Check, ChevronRight } from "lucide-react";

function StatusBar() {
  return (
    <div className="flex items-center justify-between px-5 shrink-0" style={{ height: 28, backgroundColor: "#1C1007" }}>
      <span className="text-amber-100 text-[11px] font-semibold tracking-wide">12:53</span>
      <div className="flex items-center gap-1.5">
        <div className="flex gap-[2px] items-end h-3">
          {[3,4,5,6].map((h,i) => <div key={i} style={{height:`${h*2}px`}} className="w-[3px] bg-amber-100 rounded-sm"/>)}
        </div>
        <svg width="14" height="10" viewBox="0 0 14 10" fill="#FEF3C7"><rect x="0" y="0" width="12" height="10" rx="2" stroke="#FEF3C7" strokeWidth="1" fill="none"/><rect x="1" y="1" width="8" height="8" rx="1" fill="#FEF3C7"/><rect x="12.5" y="3" width="1.5" height="4" rx="0.5" fill="#FEF3C7"/></svg>
      </div>
    </div>
  );
}

type Verdict = "yes" | "maybe" | "no";

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const styles: Record<Verdict, string> = {
    yes: "bg-emerald-900 text-emerald-300 border-emerald-700",
    maybe: "bg-amber-900 text-amber-300 border-amber-700",
    no: "bg-red-900/50 text-red-300 border-red-800",
  };
  const labels: Record<Verdict, string> = { yes: "Likely duplicate", maybe: "Possible match", no: "New to collection" };
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${styles[verdict]}`}>{labels[verdict]}</span>
  );
}

const matches = [
  { id: 1, name: "Celadon Bowl", maker: "Hamada", similarity: 94, verdict: "yes" as Verdict, emoji: "🏺", color: "#8FBC8F" },
  { id: 2, name: "Green Glaze Bowl", maker: "Unknown", similarity: 71, verdict: "maybe" as Verdict, emoji: "🏺", color: "#5A8F5A" },
  { id: 3, name: "Stoneware Bowl", maker: "Leach", similarity: 48, verdict: "no" as Verdict, emoji: "🏺", color: "#8B6914" },
];

export function PotterySearch() {
  return (
    <div className="flex flex-col w-full h-screen overflow-hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif", backgroundColor: "#1C1007" }}>
      <StatusBar />

      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-3 shrink-0" style={{ backgroundColor: "#2C1A0A", borderBottom: "1px solid rgba(180,83,9,0.3)" }}>
        <button className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: "rgba(255,255,255,0.08)" }}>
          <ArrowLeft size={16} className="text-amber-300" />
        </button>
        <div>
          <h1 className="text-[17px] font-bold text-amber-100">AI Photo Compare</h1>
          <p className="text-[11px] text-amber-600">Find duplicates in your collection</p>
        </div>
      </div>

      {/* Upload zone + result */}
      <div className="flex-1 overflow-y-auto px-4 py-4">

        {/* Photo uploaded (shown with result state) */}
        <div className="rounded-2xl overflow-hidden mb-4 border" style={{ borderColor: "rgba(180,83,9,0.4)", backgroundColor: "#2C1A0A" }}>
          <div className="h-40 flex items-center justify-center relative" style={{ background: "linear-gradient(135deg, #2D5A2D, #8FBC8F)" }}>
            <span style={{ fontSize: 72 }}>🏺</span>
            <div className="absolute top-2 right-2 bg-emerald-700 rounded-full px-2 py-0.5 flex items-center gap-1">
              <Check size={10} className="text-white" />
              <span className="text-[10px] text-white font-semibold">Photo analysed</span>
            </div>
            <button className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg px-2 py-1" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
              <RotateCcw size={11} className="text-amber-300" />
              <span className="text-[10px] text-amber-300">Try another</span>
            </button>
          </div>
        </div>

        {/* Verdict cards */}
        <div className="space-y-2 mb-4">
          {[
            { label: "Same pattern?", verdict: "yes" as Verdict, copy: "You very likely already own this pattern." },
            { label: "Exact piece?", verdict: "maybe" as Verdict, copy: "This could be a piece you already have — worth a closer look." },
          ].map(({ label, verdict, copy }) => (
            <div key={label} className="rounded-2xl px-4 py-3 border" style={{ backgroundColor: "#2C1A0A", borderColor: "rgba(180,83,9,0.3)" }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px] text-amber-600 font-medium">{label}</span>
                <VerdictBadge verdict={verdict} />
              </div>
              <p className="text-[12px] text-amber-300">{copy}</p>
            </div>
          ))}
        </div>

        {/* Match list */}
        <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-widest mb-2">Best Matches</p>
        <div className="space-y-2">
          {matches.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 border" style={{ backgroundColor: "#2C1A0A", borderColor: "rgba(180,83,9,0.25)" }}>
              <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0 text-3xl border border-amber-900"
                style={{ background: `linear-gradient(135deg, ${m.color}44, ${m.color}88)` }}>
                {m.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-amber-100 truncate">{m.name}</p>
                <p className="text-[11px] text-amber-600">{m.maker}</p>
                <VerdictBadge verdict={m.verdict} />
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <div className="text-[15px] font-bold text-amber-300">{m.similarity}%</div>
                <div className="w-12 h-1.5 rounded-full bg-amber-950 overflow-hidden">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${m.similarity}%` }} />
                </div>
                <ChevronRight size={14} className="text-amber-700 mt-0.5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
