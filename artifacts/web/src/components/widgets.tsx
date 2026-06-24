import { useState, useEffect } from "react";
import {
  ArrowRight, ShoppingBag, Package, Shirt, FlaskConical,
  Scissors, Layers, Plus, Camera, Zap, Star,
} from "lucide-react";
import {
  useGetCollectionStats,
  useListPotteryCategories,
  useGetStats,
  useListShoppingItems,
  useListPottery,
} from "@workspace/api-client-react";

const base = import.meta.env.BASE_URL;

// ── Live: Pottery stats ──────────────────────────────────────────────────────
export function PotteryStatsWidget() {
  const { data: stats } = useGetCollectionStats();
  const { data: cats } = useListPotteryCategories();
  const items = [
    { v: stats?.totalItems != null ? String(stats.totalItems) : "—", l: "Total pieces" },
    { v: stats?.uniqueItems != null ? String(stats.uniqueItems) : "—", l: "Unique" },
    { v: cats != null ? String(cats.length) : "—", l: "Categories" },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5">
        {items.map(s => (
          <div key={s.l} className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-amber-700 dark:text-amber-300">{s.v}</div>
            <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide leading-tight mt-0.5">{s.l}</div>
          </div>
        ))}
      </div>
      <a href={`${base}pottery/`} className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline">
        Open collection <ArrowRight className="w-3 h-3" />
      </a>
    </div>
  );
}

// ── Live: Quilting stats ─────────────────────────────────────────────────────
export function QuiltingStatsWidget() {
  const { data: stats } = useGetStats();
  const items = [
    { v: stats?.totalFabrics != null ? String(stats.totalFabrics) : "—", l: "Fabrics" },
    { v: stats?.totalBlocks != null ? String(stats.totalBlocks) : "—", l: "Blocks" },
    { v: stats?.totalLayouts != null ? String(stats.totalLayouts) : "—", l: "Layouts" },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5">
        {items.map(s => (
          <div key={s.l} className="bg-violet-50 dark:bg-violet-900/20 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-violet-700 dark:text-violet-300">{s.v}</div>
            <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide leading-tight mt-0.5">{s.l}</div>
          </div>
        ))}
      </div>
      <a href={`${base}quilting/fabrics`} className="flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline">
        Open quilting <ArrowRight className="w-3 h-3" />
      </a>
    </div>
  );
}

// ── Live: Shopping list ──────────────────────────────────────────────────────
export function ShoppingListWidget() {
  const { data } = useListShoppingItems();
  const items = data?.slice(0, 4) ?? [];
  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No items on your list yet.</p>
      )}
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2 text-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" />
          <span className="flex-1 truncate">{item.name}</span>
          {item.quantity != null && (
            <span className="text-xs text-muted-foreground flex-shrink-0">{item.quantity}{item.unit ? ` ${item.unit}` : ""}</span>
          )}
        </div>
      ))}
      <a href={`${base}quilting/shopping`} className="flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline">
        <ShoppingBag className="w-3 h-3" /> View full list
      </a>
    </div>
  );
}

// ── Live: Random pottery piece ───────────────────────────────────────────────
export function RandomPieceWidget() {
  const { data } = useListPottery({});
  const [idx, setIdx] = useState(0);
  const piece = data && data.length > 0 ? data[idx % data.length] : null;

  function next() {
    if (data) setIdx(i => (i + 1) % data.length);
  }

  if (!piece) {
    return <p className="text-xs text-muted-foreground italic">No pieces in your collection yet.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
          <Package className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{piece.name}</div>
          {piece.style && (
            <div className="text-xs text-muted-foreground mt-0.5">{piece.style}</div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <a href={`${base}pottery/piece/${piece.id}`} className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1">
          View piece <ArrowRight className="w-3 h-3" />
        </a>
        <button onClick={next} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
          <Star className="w-3 h-3" /> Next
        </button>
      </div>
    </div>
  );
}

// ── Static: Maintenance ──────────────────────────────────────────────────────
export function MaintenanceWidget() {
  const tasks = [
    { label: "Check glaze on stoneware mug", due: "Overdue", warn: true },
    { label: "Re-fire chipped earthenware bowl", due: "This week", warn: false },
    { label: "Document new firing batch", due: "Next week", warn: false },
  ];
  return (
    <div className="space-y-2">
      {tasks.map((t, i) => (
        <div key={i} className="flex items-center gap-2.5 text-sm">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.warn ? "bg-amber-500" : "bg-muted-foreground/40"}`} />
          <span className="flex-1 truncate">{t.label}</span>
          <span className={`text-[10px] font-medium flex-shrink-0 ${t.warn ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{t.due}</span>
        </div>
      ))}
      <a href={`${base}pottery/maintenance`} className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline">
        <FlaskConical className="w-3 h-3" /> Maintenance log
      </a>
    </div>
  );
}

// ── Static: Fabric stash summary ─────────────────────────────────────────────
export function FabricStashWidget() {
  const { data: stats } = useGetStats();
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
          <Shirt className="w-5 h-5 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <div className="text-xl font-bold text-violet-700 dark:text-violet-300">
            {stats?.totalFabrics != null ? stats.totalFabrics : "—"}
          </div>
          <div className="text-xs text-muted-foreground">fabrics in your stash</div>
        </div>
      </div>
      <div className="flex gap-2">
        <a href={`${base}quilting/fabrics`} className="flex-1 text-center text-xs font-medium py-1.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors">
          Browse fabrics
        </a>
        <a href={`${base}quilting/fabrics/add`} className="flex items-center justify-center gap-1 px-3 text-xs font-medium py-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors">
          <Plus className="w-3 h-3" /> Add
        </a>
      </div>
    </div>
  );
}

// ── Static: Block designer ────────────────────────────────────────────────────
export function BlockDesignerWidget() {
  const { data: stats } = useGetStats();
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
          <Scissors className="w-5 h-5 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <div className="text-xl font-bold text-violet-700 dark:text-violet-300">
            {stats?.totalBlocks != null ? stats.totalBlocks : "—"}
          </div>
          <div className="text-xs text-muted-foreground">blocks designed</div>
        </div>
      </div>
      <div className="flex gap-2">
        <a href={`${base}quilting/blocks`} className="flex-1 text-center text-xs font-medium py-1.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors">
          View blocks
        </a>
        <a href={`${base}quilting/blocks/new`} className="flex items-center justify-center gap-1 px-3 text-xs font-medium py-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors">
          <Plus className="w-3 h-3" /> New
        </a>
      </div>
    </div>
  );
}

// ── Static: Layouts ───────────────────────────────────────────────────────────
export function LayoutsWidget() {
  const { data: stats } = useGetStats();
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
          <Layers className="w-5 h-5 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <div className="text-xl font-bold text-violet-700 dark:text-violet-300">
            {stats?.totalLayouts != null ? stats.totalLayouts : "—"}
          </div>
          <div className="text-xs text-muted-foreground">quilt layouts planned</div>
        </div>
      </div>
      <a href={`${base}quilting/layouts`} className="flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline">
        <Layers className="w-3 h-3" /> View layouts
      </a>
    </div>
  );
}

// ── Static: Quick Add ─────────────────────────────────────────────────────────
export function QuickAddWidget() {
  const actions = [
    { label: "Add pottery piece", href: `${base}pottery/add`, icon: Package, color: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20" },
    { label: "Add fabric", href: `${base}quilting/fabrics/add`, icon: Shirt, color: "text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20" },
    { label: "Add quilt block", href: `${base}quilting/blocks/new`, icon: Scissors, color: "text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20" },
    { label: "Do I own this?", href: `${base}pottery/compare`, icon: Camera, color: "text-primary bg-primary/10" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {actions.map(a => (
        <a key={a.href} href={a.href} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors hover:opacity-80 ${a.color}`}>
          <a.icon className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="leading-tight">{a.label}</span>
        </a>
      ))}
    </div>
  );
}

// ── Static: AI Search ────────────────────────────────────────────────────────
export function AiSearchWidget() {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Take a photo or describe a piece — AI checks both your pottery and fabric collections instantly.
      </p>
      <div className="flex gap-2">
        <a href={`${base}pottery/compare`} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors">
          <Camera className="w-3.5 h-3.5" /> Pottery
        </a>
        <a href={`${base}quilting/compare`} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-violet-100 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 text-xs font-medium hover:opacity-80 transition-colors">
          <Camera className="w-3.5 h-3.5" /> Fabric
        </a>
      </div>
    </div>
  );
}

// ── Interactive: Sticky Notes ────────────────────────────────────────────────
const NOTES_KEY = "batchelor-widget-notes";

export function NotesWidget() {
  const [text, setText] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(NOTES_KEY) ?? "";
  });

  useEffect(() => {
    window.localStorage.setItem(NOTES_KEY, text);
  }, [text]);

  return (
    <textarea
      value={text}
      onChange={e => setText(e.target.value)}
      placeholder="Jot down a quick note…"
      className="w-full h-20 text-xs bg-yellow-50 dark:bg-yellow-900/10 border-0 resize-none rounded-lg p-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
    />
  );
}

// ── Interactive: Countdown ────────────────────────────────────────────────────
const CRAFT_FAIR = new Date("2026-09-20T09:00:00");

export function CountdownWidget() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const diff = CRAFT_FAIR.getTime() - now.getTime();
  const days = Math.max(0, Math.floor(diff / 86_400_000));
  const hours = Math.max(0, Math.floor((diff % 86_400_000) / 3_600_000));

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        Until: Autumn Craft Fair · Sep 20
      </div>
      <div className="flex items-end gap-3">
        <div className="text-center">
          <div className="text-3xl font-bold text-primary tabular-nums">{days}</div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-wide">days</div>
        </div>
        <div className="text-3xl font-bold text-muted-foreground/30 pb-1">:</div>
        <div className="text-center">
          <div className="text-3xl font-bold text-primary tabular-nums">{hours}</div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-wide">hours</div>
        </div>
      </div>
    </div>
  );
}

// ── Static: Glaze tip ────────────────────────────────────────────────────────
const GLAZE_TIPS = [
  { tip: "Wax resist on the foot ring prevents glaze from fusing the pot to the kiln shelf.", source: "Kiln Technique" },
  { tip: "Adding 2–5% red iron oxide to a clear glaze creates warm amber tones in reduction.", source: "Glaze Chemistry" },
  { tip: "Let bisque cool fully before glazing — residual warmth can cause glaze crawling.", source: "Studio Practice" },
  { tip: "Three thin coats beats one thick coat: better adhesion and fewer crawl defects.", source: "Application Tips" },
  { tip: "Cobalt carbonate is more evenly distributed than cobalt oxide for consistent blues.", source: "Glaze Materials" },
  { tip: "Test tiles save every glaze batch — fire one before committing the whole piece.", source: "QA Practice" },
];

export function GlazeTipWidget() {
  const [i] = useState(() => Math.floor(Math.random() * GLAZE_TIPS.length));
  const tip = GLAZE_TIPS[i];
  return (
    <div className="space-y-2">
      <p className="text-sm leading-relaxed text-foreground">{tip.tip}</p>
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{tip.source}</div>
    </div>
  );
}

// ── Static: Quilt pattern idea ────────────────────────────────────────────────
const PATTERN_IDEAS = [
  { name: "Log Cabin", desc: "Classic strips radiating from a centre square — great for scrap fabrics.", difficulty: "Beginner" },
  { name: "Flying Geese", desc: "Triangular units that create movement and direction across the quilt top.", difficulty: "Intermediate" },
  { name: "Nine Patch", desc: "The foundational block — nine equal squares in a 3×3 grid.", difficulty: "Beginner" },
  { name: "Lone Star", desc: "Eight diamond points meeting at the centre — a showpiece pattern.", difficulty: "Advanced" },
  { name: "Bear's Paw", desc: "Clawed corners give a rustic, nature-inspired look to sampler quilts.", difficulty: "Intermediate" },
];

export function PatternIdeaWidget() {
  const [i] = useState(() => Math.floor(Math.random() * PATTERN_IDEAS.length));
  const p = PATTERN_IDEAS[i];
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold">{p.name}</div>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
          p.difficulty === "Beginner" ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" :
          p.difficulty === "Advanced" ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300" :
          "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
        }`}>{p.difficulty}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{p.desc}</p>
      <a href={`${base}quilting/blocks/new`} className="flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline">
        Try this block <ArrowRight className="w-3 h-3" />
      </a>
    </div>
  );
}

// ── Static: Craft News ────────────────────────────────────────────────────────
export function CraftNewsWidget() {
  const articles = [
    { title: "Glaze chemistry: reduction firing basics", cat: "Pottery", time: "2h ago", href: "https://ceramicartsnetwork.org/ceramics-technical/glaze-chemistry/" },
    { title: "5 quilt-binding techniques compared", cat: "Quilting", time: "1d ago", href: "https://www.quiltingdaily.com/binding-techniques/" },
    { title: "Choosing clay bodies for outdoor sculpture", cat: "Pottery", time: "3d ago", href: "https://digitalfire.com/glossary/outdoor+clay+body" },
    { title: "English paper piecing revival — hexagons return", cat: "Quilting", time: "5d ago", href: "https://missouriquiltco.com/blog/english-paper-piecing" },
  ];
  return (
    <ul className="space-y-2.5">
      {articles.map((a, i) => (
        <li key={i}>
          <a href={a.href} target="_blank" rel="noopener noreferrer"
            className="flex items-start gap-2 hover:opacity-80 transition-opacity group">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${a.cat === "Pottery" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" : "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300"}`}>
              {a.cat.charAt(0)}
            </span>
            <span className="text-xs leading-snug text-foreground flex-1 group-hover:underline">{a.title}</span>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">{a.time}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

// ── Static: RSS Feeds ────────────────────────────────────────────────────────
export function RssFeedsWidget() {
  const posts = [
    { feed: "Studio Pottery Weekly", title: "New issue: Soda-firing special", time: "Today", href: "https://studiopottery.com" },
    { feed: "Modern Quilting Blog", title: "3 posts this week", time: "Today", href: "https://www.quilts.com/blogs/news" },
    { feed: "Ceramic Arts Network", title: "Glaze calculation tools reviewed", time: "Yesterday", href: "https://ceramicartsnetwork.org" },
    { feed: "The Quilt Show", title: "Free pattern: Tumbling Blocks", time: "2d ago", href: "https://www.thequiltshow.com" },
  ];
  return (
    <ul className="space-y-2">
      {posts.map((p, i) => (
        <li key={i}>
          <a href={p.href} target="_blank" rel="noopener noreferrer"
            className="flex items-start gap-2 hover:opacity-80 transition-opacity group">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0 mt-1.5" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide truncate">{p.feed}</div>
              <div className="text-xs text-foreground leading-snug truncate group-hover:underline">{p.title}</div>
            </div>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">{p.time}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

// ── Static: Collection Activity ──────────────────────────────────────────────
export function ActivityWidget() {
  const items = [
    { icon: Package, label: "Added 'Speckled Mug'", sub: "Pottery", time: "2h ago", color: "text-amber-500", href: `${base}pottery/` },
    { icon: Shirt, label: "Updated fabric stash", sub: "Quilting", time: "Yesterday", color: "text-violet-500", href: `${base}quilting/fabrics` },
    { icon: Scissors, label: "Created 'Bear Claw' block", sub: "Quilting", time: "2 days ago", color: "text-violet-500", href: `${base}quilting/blocks` },
    { icon: Package, label: "Added 'Serving bowl'", sub: "Pottery", time: "3 days ago", color: "text-amber-500", href: `${base}pottery/` },
  ];
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i}>
          <a href={item.href} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity group">
            <item.icon className={`w-3.5 h-3.5 flex-shrink-0 ${item.color}`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs truncate group-hover:underline">{item.label}</div>
              <div className="text-[10px] text-muted-foreground">{item.sub}</div>
            </div>
            <span className="text-[10px] text-muted-foreground flex-shrink-0 whitespace-nowrap">{item.time}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

// ── Static: Goals ─────────────────────────────────────────────────────────────
export function GoalsWidget() {
  const goals = [
    { label: "Add 10 new pottery pieces", current: 7, target: 10, color: "bg-amber-500" },
    { label: "Use up blue fabric stash", current: 4, target: 8, color: "bg-violet-500" },
    { label: "Complete Spring Sampler layout", current: 2, target: 3, color: "bg-emerald-500" },
  ];
  return (
    <div className="space-y-3">
      {goals.map((g, i) => (
        <div key={i} className="space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-xs text-foreground truncate flex-1 mr-2">{g.label}</span>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">{g.current}/{g.target}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${g.color}`} style={{ width: `${Math.min(100, (g.current / g.target) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Static: Quick Inspiration ─────────────────────────────────────────────────
const INSPIRATIONS = [
  "A well-thrown bowl is defined by what it can hold.",
  "Fabric is just colour waiting to be rearranged.",
  "The kiln doesn't lie — only practice makes the form.",
  "Every quilt tells the story of the hands that made it.",
  "Clay remembers every touch; make each one deliberate.",
];

export function InspirationWidget() {
  const [i] = useState(() => Math.floor(Math.random() * INSPIRATIONS.length));
  return (
    <div className="flex items-start gap-2.5">
      <span className="text-3xl leading-none mt-0.5 flex-shrink-0" aria-hidden>✦</span>
      <p className="text-sm text-foreground leading-relaxed italic">{INSPIRATIONS[i]}</p>
    </div>
  );
}

// ── Static: Photo of the Day ──────────────────────────────────────────────────
export function PhotoOfDayWidget() {
  const { data } = useListPottery({});
  const piece = data && data.length > 0 ? data[Math.floor(Math.random() * data.length)] : null;

  return (
    <div className="space-y-2">
      <div className="h-24 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
        {piece ? (
          <div className="flex flex-col items-center text-center p-3">
            <Package className="w-8 h-8 text-muted-foreground/40 mb-1" />
            <div className="text-xs font-medium truncate max-w-full">{piece.name}</div>
            {piece.style && <div className="text-[10px] text-muted-foreground">{piece.style}</div>}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">No pieces yet</div>
        )}
      </div>
      {piece && (
        <a href={`${base}pottery/piece/${piece.id}`} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          View piece <ArrowRight className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

// ── Static: Maker Links ────────────────────────────────────────────────────────
export function MakerLinksWidget() {
  const links = [
    { label: "Digitalfire (glaze reference)", href: "https://digitalfire.com" },
    { label: "Ceramic Arts Network", href: "https://ceramicartsnetwork.org" },
    { label: "Missouri Star Quilt Co.", href: "https://missouriquiltco.com" },
    { label: "The Quilting Company", href: "https://thequiltingcompany.com" },
  ];
  return (
    <ul className="space-y-1.5">
      {links.map((l, i) => (
        <li key={i}>
          <a href={l.href} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-primary hover:underline truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-primary/50 flex-shrink-0" />
            {l.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

// ── Static: Studio weather (re-export) ────────────────────────────────────────
export { StudioWeather } from "@/components/studio-weather";
