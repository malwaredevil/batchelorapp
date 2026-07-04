import {
  Search,
  Plus,
  ScanSearch,
  Grid3X3,
  SlidersHorizontal,
  Star,
  Settings,
  Camera,
  ChevronDown,
  Package,
} from "lucide-react";

function StatusBar() {
  return (
    <div
      className="flex items-center justify-between px-5 shrink-0"
      style={{ height: 28, backgroundColor: "#1C1007" }}
    >
      <span className="text-amber-100 text-[11px] font-semibold tracking-wide">
        12:51
      </span>
      <div className="flex items-center gap-1.5">
        <div className="flex gap-[2px] items-end h-3">
          {[3, 4, 5, 6].map((h, i) => (
            <div
              key={i}
              style={{ height: `${h * 2}px` }}
              className="w-[3px] bg-amber-100 rounded-sm"
            />
          ))}
        </div>
        <svg width="14" height="10" viewBox="0 0 14 10" fill="#FEF3C7">
          <rect
            x="0"
            y="0"
            width="12"
            height="10"
            rx="2"
            stroke="#FEF3C7"
            strokeWidth="1"
            fill="none"
          />
          <rect x="1" y="1" width="8" height="8" rx="1" fill="#FEF3C7" />
          <rect x="12.5" y="3" width="1.5" height="4" rx="0.5" fill="#FEF3C7" />
        </svg>
      </div>
    </div>
  );
}

function BottomTabBar() {
  const tabs = [
    { label: "Collection", Icon: Package, active: true },
    { label: "Compare", Icon: ScanSearch, active: false },
    { label: "Favourites", Icon: Star, active: false },
    { label: "Settings", Icon: Settings, active: false },
  ];
  return (
    <div
      className="flex items-center bg-amber-950 border-t border-amber-900 shrink-0"
      style={{ height: 60, paddingBottom: 4 }}
    >
      {tabs.map((t) => {
        const Icon = t.Icon;
        return (
          <div
            key={t.label}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 pt-1"
          >
            <Icon
              size={20}
              className={t.active ? "text-amber-400" : "text-amber-700"}
              strokeWidth={t.active ? 2.5 : 1.8}
            />
            <span
              className={`text-[10px] font-medium ${t.active ? "text-amber-400" : "text-amber-700"}`}
            >
              {t.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const items = [
  {
    id: 1,
    name: "Celadon Bowl",
    maker: "Hamada",
    year: "1962",
    emoji: "🏺",
    color: "#8FBC8F",
  },
  {
    id: 2,
    name: "Raku Tea Bowl",
    maker: "Unknown",
    year: "c.1600",
    emoji: "⚫",
    color: "#3D2B1F",
  },
  {
    id: 3,
    name: "Stoneware Vase",
    maker: "Leach",
    year: "1948",
    emoji: "🫙",
    color: "#8B6914",
  },
  {
    id: 4,
    name: "Blue & White Jar",
    maker: "Jingdezhen",
    year: "1850",
    emoji: "🏛️",
    color: "#2D4A6B",
  },
  {
    id: 5,
    name: "Salt-Glaze Jug",
    maker: "Unknown",
    year: "1800s",
    emoji: "🫗",
    color: "#7B6B5A",
  },
  {
    id: 6,
    name: "Porcelain Plate",
    maker: "Wedgwood",
    year: "1910",
    emoji: "⬜",
    color: "#E8E0D5",
  },
];

export function PotteryList() {
  return (
    <div
      className="flex flex-col w-full h-screen overflow-hidden"
      style={{
        fontFamily: "'Inter', system-ui, sans-serif",
        backgroundColor: "#1C1007",
      }}
    >
      <StatusBar />

      {/* App bar */}
      <div
        className="px-4 pt-3 pb-2 shrink-0"
        style={{ backgroundColor: "#2C1A0A" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[11px] text-amber-600 font-medium uppercase tracking-widest">
              Ashley's Studio
            </p>
            <h1 className="text-[22px] font-bold text-amber-100 leading-tight">
              My Pottery
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "rgba(217,119,6,0.2)" }}
            >
              <ScanSearch size={18} className="text-amber-400" />
            </button>
            <button
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "rgba(255,255,255,0.07)" }}
            >
              <Search size={18} className="text-amber-300" />
            </button>
          </div>
        </div>
        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {["All (163)", "Bowl", "Vase", "Plate", "Jar"].map((chip, i) => (
            <button
              key={chip}
              className={`shrink-0 px-3 py-1 rounded-full text-[12px] font-medium border ${i === 0 ? "text-amber-900 border-amber-400" : "text-amber-500 border-amber-800"}`}
              style={i === 0 ? { backgroundColor: "#D97706" } : {}}
            >
              {chip}
            </button>
          ))}
          <button className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center border border-amber-800">
            <SlidersHorizontal size={12} className="text-amber-500" />
          </button>
        </div>
      </div>

      {/* Sort row */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0">
        <span className="text-[12px] text-amber-700">163 pieces</span>
        <button className="flex items-center gap-1 text-[12px] text-amber-400 font-medium">
          Newest first <ChevronDown size={13} />
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-3 pb-2">
        <div className="grid grid-cols-2 gap-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl overflow-hidden border"
              style={{
                backgroundColor: "#2C1A0A",
                borderColor: "rgba(180,83,9,0.3)",
              }}
            >
              <div
                className="h-28 flex items-center justify-center relative"
                style={{
                  background: `linear-gradient(135deg, ${item.color}33, ${item.color}88)`,
                }}
              >
                <span className="text-5xl">{item.emoji}</span>
              </div>
              <div className="p-2.5">
                <p className="text-[13px] font-semibold text-amber-100 truncate">
                  {item.name}
                </p>
                <p className="text-[10px] text-amber-600 mt-0.5">
                  {item.maker} · {item.year}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* FAB */}
      <div className="absolute bottom-[72px] right-4">
        <button
          className="w-14 h-14 rounded-full shadow-lg flex items-center justify-center"
          style={{ backgroundColor: "#D97706" }}
        >
          <Plus size={26} className="text-white" strokeWidth={2.5} />
        </button>
      </div>

      <BottomTabBar />
    </div>
  );
}
