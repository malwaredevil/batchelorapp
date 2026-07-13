import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ShoppingBag,
  Package,
  Shirt,
  FlaskConical,
  Scissors,
  Layers,
  Plus,
  Camera,
  Zap,
  Star,
  Rss,
  Settings,
  ExternalLink,
  AlertCircle,
  Loader2,
  RefreshCw,
  Plane,
  Globe,
  Bell,
  MapPin,
  List,
  X,
  NotebookPen,
  Send,
} from "lucide-react";
import {
  useGetCollectionStats,
  useListPotteryCategories,
  useGetStats,
  useListShoppingItems,
  useListPottery,
  useGetTravelsStats,
  useListAllReminders,
  useListWishlist,
  useListNotes,
  useCreateNote,
  getListNotesQueryKey,
  type OfficeNote,
} from "@workspace/api-client-react";

const base = import.meta.env.BASE_URL;

// ── Live: Pottery stats ──────────────────────────────────────────────────────
export function PotteryStatsWidget() {
  const { data: stats } = useGetCollectionStats();
  const { data: cats } = useListPotteryCategories();
  const items = [
    {
      v: stats?.totalItems != null ? String(stats.totalItems) : "—",
      l: "Total pieces",
    },
    {
      v: stats?.uniqueItems != null ? String(stats.uniqueItems) : "—",
      l: "Unique",
    },
    { v: cats != null ? String(cats.length) : "—", l: "Categories" },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5">
        {items.map((s) => (
          <div
            key={s.l}
            className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2 text-center"
          >
            <div className="text-lg font-bold text-amber-700 dark:text-amber-300">
              {s.v}
            </div>
            <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide leading-tight mt-0.5">
              {s.l}
            </div>
          </div>
        ))}
      </div>
      <a
        href={`${base}pottery/`}
        className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline"
      >
        Open collection <ArrowRight className="w-3 h-3" />
      </a>
    </div>
  );
}

// ── Live: Quilting stats ─────────────────────────────────────────────────────
export function QuiltingStatsWidget() {
  const { data: stats } = useGetStats();
  const items = [
    {
      v: stats?.totalFabrics != null ? String(stats.totalFabrics) : "—",
      l: "Fabrics",
    },
    {
      v: stats?.totalBlocks != null ? String(stats.totalBlocks) : "—",
      l: "Blocks",
    },
    {
      v: stats?.totalLayouts != null ? String(stats.totalLayouts) : "—",
      l: "Layouts",
    },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5">
        {items.map((s) => (
          <div
            key={s.l}
            className="bg-violet-50 dark:bg-violet-900/20 rounded-lg p-2 text-center"
          >
            <div className="text-lg font-bold text-violet-700 dark:text-violet-300">
              {s.v}
            </div>
            <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide leading-tight mt-0.5">
              {s.l}
            </div>
          </div>
        ))}
      </div>
      <a
        href={`${base}quilting/fabrics`}
        className="flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline"
      >
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
        <p className="text-xs text-muted-foreground italic">
          No items on your list yet.
        </p>
      )}
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-2 text-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" />
          <span className="flex-1 truncate">{item.name}</span>
          {item.quantity != null && (
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {item.quantity}
              {item.unit ? ` ${item.unit}` : ""}
            </span>
          )}
        </div>
      ))}
      <a
        href={`${base}quilting/shopping`}
        className="flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline"
      >
        <ShoppingBag className="w-3 h-3" /> View full list
      </a>
    </div>
  );
}

// ── Live: Random pottery piece ───────────────────────────────────────────────
export function RandomPieceWidget() {
  const { data: _pList } = useListPottery({});
  const data = _pList?.items;
  const [idx, setIdx] = useState(0);
  const piece = data && data.length > 0 ? data[idx % data.length] : null;

  function next() {
    if (data) setIdx((i) => (i + 1) % data.length);
  }

  if (!piece) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No pieces in your collection yet.
      </p>
    );
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
            <div className="text-xs text-muted-foreground mt-0.5">
              {piece.style}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <a
          href={`${base}pottery/piece/${piece.id}`}
          className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
        >
          View piece <ArrowRight className="w-3 h-3" />
        </a>
        <button
          onClick={next}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
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
    {
      label: "Re-fire chipped earthenware bowl",
      due: "This week",
      warn: false,
    },
    { label: "Document new firing batch", due: "Next week", warn: false },
  ];
  return (
    <div className="space-y-2">
      {tasks.map((t, i) => (
        <div key={i} className="flex items-center gap-2.5 text-sm">
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.warn ? "bg-amber-500" : "bg-muted-foreground/40"}`}
          />
          <span className="flex-1 truncate">{t.label}</span>
          <span
            className={`text-[10px] font-medium flex-shrink-0 ${t.warn ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
          >
            {t.due}
          </span>
        </div>
      ))}
      <a
        href={`${base}pottery/maintenance`}
        className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline"
      >
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
          <div className="text-xs text-muted-foreground">
            fabrics in your stash
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <a
          href={`${base}quilting/fabrics`}
          className="flex-1 text-center text-xs font-medium py-1.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
        >
          Browse fabrics
        </a>
        <a
          href={`${base}quilting/fabrics/add`}
          className="flex items-center justify-center gap-1 px-3 text-xs font-medium py-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
        >
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
        <a
          href={`${base}quilting/blocks`}
          className="flex-1 text-center text-xs font-medium py-1.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
        >
          View blocks
        </a>
        <a
          href={`${base}quilting/blocks/new`}
          className="flex items-center justify-center gap-1 px-3 text-xs font-medium py-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
        >
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
          <div className="text-xs text-muted-foreground">
            quilt layouts planned
          </div>
        </div>
      </div>
      <a
        href={`${base}quilting/layouts`}
        className="flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline"
      >
        <Layers className="w-3 h-3" /> View layouts
      </a>
    </div>
  );
}

// ── Static: Quick Add ─────────────────────────────────────────────────────────
export function QuickAddWidget() {
  const actions = [
    {
      label: "Add pottery piece",
      href: `${base}pottery/add`,
      icon: Package,
      color:
        "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20",
    },
    {
      label: "Add fabric",
      href: `${base}quilting/fabrics/add`,
      icon: Shirt,
      color:
        "text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20",
    },
    {
      label: "Add quilt block",
      href: `${base}quilting/blocks/new`,
      icon: Scissors,
      color:
        "text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20",
    },
    {
      label: "Do I own this?",
      href: `${base}pottery/compare`,
      icon: Camera,
      color: "text-primary bg-primary/10",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {actions.map((a) => (
        <a
          key={a.href}
          href={a.href}
          className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors hover:opacity-80 ${a.color}`}
        >
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
        Take a photo or describe a piece — AI checks both your pottery and
        fabric collections instantly.
      </p>
      <div className="flex gap-2">
        <a
          href={`${base}pottery/compare`}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
        >
          <Camera className="w-3.5 h-3.5" /> Pottery
        </a>
        <a
          href={`${base}quilting/compare`}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-violet-100 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 text-xs font-medium hover:opacity-80 transition-colors"
        >
          <Camera className="w-3.5 h-3.5" /> Fabric
        </a>
      </div>
    </div>
  );
}

// ── Interactive: Office Notes widget ─────────────────────────────────────────
function stripTags(html: string) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function NotesWidget() {
  const { data: notes } = useListNotes();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"list" | "create" | "view">("list");
  const [pinnedNote, setPinnedNote] = useState<OfficeNote | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const createNote = useCreateNote({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getListNotesQueryKey(),
        });
        setMode("list");
        setTitle("");
        setBody("");
      },
    },
  });

  const recent = (notes ?? []).slice(0, 4);

  if (mode === "create") {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            New Note
          </span>
          <button
            onClick={() => {
              setMode("list");
              setTitle("");
              setBody("");
            }}
            className="text-muted-foreground hover:text-foreground p-0.5 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title…"
          maxLength={200}
          className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your note…"
          rows={4}
          maxLength={20000}
          className="w-full text-xs bg-yellow-50 dark:bg-yellow-900/10 border border-border rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <div className="flex gap-1.5">
          <button
            disabled={!title.trim() || createNote.isPending}
            onClick={() =>
              createNote.mutate({ data: { title: title.trim(), body } })
            }
            className="flex-1 flex items-center justify-center gap-1 text-xs font-medium bg-primary text-primary-foreground rounded px-2 py-1.5 disabled:opacity-50 hover:bg-primary/90 transition-colors"
          >
            {createNote.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
            Save note
          </button>
        </div>
      </div>
    );
  }

  if (mode === "view" && pinnedNote) {
    const bodyText = stripTags(pinnedNote.body);
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold truncate flex-1 pr-2">
            {pinnedNote.title}
          </span>
          <button
            onClick={() => {
              setMode("list");
              setPinnedNote(null);
            }}
            className="text-muted-foreground hover:text-foreground p-0.5 rounded flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div
          className="text-xs text-foreground/80 rounded-lg p-2.5 max-h-32 overflow-y-auto leading-relaxed whitespace-pre-wrap"
          style={{
            backgroundColor:
              pinnedNote.backgroundColor ?? "rgb(254 249 195 / 0.6)",
          }}
        >
          {bodyText || (
            <span className="italic text-muted-foreground">(empty)</span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <button
            onClick={() => setMode("list")}
            className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            ← All notes
          </button>
          <a
            href={`${base}office/notes`}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Open Office <ArrowRight className="w-3 h-3" />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Office Notes
        </span>
        <button
          onClick={() => setMode("create")}
          className="flex items-center gap-0.5 text-xs font-medium text-primary hover:text-primary/80 rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
        >
          <Plus className="w-3 h-3" /> New
        </button>
      </div>

      {recent.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-1">
          No notes yet — tap New to create one.
        </p>
      ) : (
        <div className="space-y-0.5">
          {recent.map((note) => (
            <button
              key={note.id}
              onClick={() => {
                setPinnedNote(note);
                setMode("view");
              }}
              className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted transition-colors group"
            >
              <NotebookPen className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="text-xs font-medium truncate flex-1">
                {note.title}
              </span>
              <span className="text-[9px] text-muted-foreground flex-shrink-0 opacity-60 group-hover:opacity-100">
                {new Date(note.updatedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </button>
          ))}
        </div>
      )}

      <a
        href={`${base}office/notes`}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary hover:underline pt-0.5"
      >
        Open Notes <ArrowRight className="w-3 h-3" />
      </a>
    </div>
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
          <div className="text-3xl font-bold text-primary tabular-nums">
            {days}
          </div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-wide">
            days
          </div>
        </div>
        <div className="text-3xl font-bold text-muted-foreground/30 pb-1">
          :
        </div>
        <div className="text-center">
          <div className="text-3xl font-bold text-primary tabular-nums">
            {hours}
          </div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-wide">
            hours
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Static: Glaze tip ────────────────────────────────────────────────────────
const GLAZE_TIPS = [
  {
    tip: "Wax resist on the foot ring prevents glaze from fusing the pot to the kiln shelf.",
    source: "Kiln Technique",
  },
  {
    tip: "Adding 2–5% red iron oxide to a clear glaze creates warm amber tones in reduction.",
    source: "Glaze Chemistry",
  },
  {
    tip: "Let bisque cool fully before glazing — residual warmth can cause glaze crawling.",
    source: "Studio Practice",
  },
  {
    tip: "Three thin coats beats one thick coat: better adhesion and fewer crawl defects.",
    source: "Application Tips",
  },
  {
    tip: "Cobalt carbonate is more evenly distributed than cobalt oxide for consistent blues.",
    source: "Glaze Materials",
  },
  {
    tip: "Test tiles save every glaze batch — fire one before committing the whole piece.",
    source: "QA Practice",
  },
];

export function GlazeTipWidget() {
  const [i] = useState(() => Math.floor(Math.random() * GLAZE_TIPS.length));
  const tip = GLAZE_TIPS[i];
  return (
    <div className="space-y-2">
      <p className="text-sm leading-relaxed text-foreground">{tip.tip}</p>
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        {tip.source}
      </div>
    </div>
  );
}

// ── Static: Quilt pattern idea ────────────────────────────────────────────────
const PATTERN_IDEAS = [
  {
    name: "Log Cabin",
    desc: "Classic strips radiating from a centre square — great for scrap fabrics.",
    difficulty: "Beginner",
  },
  {
    name: "Flying Geese",
    desc: "Triangular units that create movement and direction across the quilt top.",
    difficulty: "Intermediate",
  },
  {
    name: "Nine Patch",
    desc: "The foundational block — nine equal squares in a 3×3 grid.",
    difficulty: "Beginner",
  },
  {
    name: "Lone Star",
    desc: "Eight diamond points meeting at the centre — a showpiece pattern.",
    difficulty: "Advanced",
  },
  {
    name: "Bear's Paw",
    desc: "Clawed corners give a rustic, nature-inspired look to sampler quilts.",
    difficulty: "Intermediate",
  },
];

export function PatternIdeaWidget() {
  const [i] = useState(() => Math.floor(Math.random() * PATTERN_IDEAS.length));
  const p = PATTERN_IDEAS[i];
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold">{p.name}</div>
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
            p.difficulty === "Beginner"
              ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
              : p.difficulty === "Advanced"
                ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
          }`}
        >
          {p.difficulty}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{p.desc}</p>
      <a
        href={`${base}quilting/blocks/new`}
        className="flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline"
      >
        Try this block <ArrowRight className="w-3 h-3" />
      </a>
    </div>
  );
}

// ── Static: Collection Activity ──────────────────────────────────────────────
export function ActivityWidget() {
  const items = [
    {
      icon: Package,
      label: "Added 'Speckled Mug'",
      sub: "Pottery",
      time: "2h ago",
      color: "text-amber-500",
      href: `${base}pottery/`,
    },
    {
      icon: Shirt,
      label: "Updated fabric stash",
      sub: "Quilting",
      time: "Yesterday",
      color: "text-violet-500",
      href: `${base}quilting/fabrics`,
    },
    {
      icon: Scissors,
      label: "Created 'Bear Claw' block",
      sub: "Quilting",
      time: "2 days ago",
      color: "text-violet-500",
      href: `${base}quilting/blocks`,
    },
    {
      icon: Package,
      label: "Added 'Serving bowl'",
      sub: "Pottery",
      time: "3 days ago",
      color: "text-amber-500",
      href: `${base}pottery/`,
    },
  ];
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i}>
          <a
            href={item.href}
            className="flex items-center gap-2.5 hover:opacity-80 transition-opacity group"
          >
            <item.icon className={`w-3.5 h-3.5 flex-shrink-0 ${item.color}`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs truncate group-hover:underline">
                {item.label}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {item.sub}
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground flex-shrink-0 whitespace-nowrap">
              {item.time}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

// ── Static: Goals ─────────────────────────────────────────────────────────────
export function GoalsWidget() {
  const goals = [
    {
      label: "Add 10 new pottery pieces",
      current: 7,
      target: 10,
      color: "bg-amber-500",
    },
    {
      label: "Use up blue fabric stash",
      current: 4,
      target: 8,
      color: "bg-violet-500",
    },
    {
      label: "Complete Spring Sampler layout",
      current: 2,
      target: 3,
      color: "bg-emerald-500",
    },
  ];
  return (
    <div className="space-y-3">
      {goals.map((g, i) => (
        <div key={i} className="space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-xs text-foreground truncate flex-1 mr-2">
              {g.label}
            </span>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">
              {g.current}/{g.target}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${g.color}`}
              style={{
                width: `${Math.min(100, (g.current / g.target) * 100)}%`,
              }}
            />
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
      <span className="text-3xl leading-none mt-0.5 flex-shrink-0" aria-hidden>
        ✦
      </span>
      <p className="text-sm text-foreground leading-relaxed italic">
        {INSPIRATIONS[i]}
      </p>
    </div>
  );
}

// ── Static: Photo of the Day ──────────────────────────────────────────────────
export function PhotoOfDayWidget() {
  const { data: _pList2 } = useListPottery({});
  const data = _pList2?.items;
  const piece =
    data && data.length > 0
      ? data[Math.floor(Math.random() * data.length)]
      : null;

  return (
    <div className="space-y-2">
      <div className="h-24 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
        {piece ? (
          <div className="flex flex-col items-center text-center p-3">
            <Package className="w-8 h-8 text-muted-foreground/40 mb-1" />
            <div className="text-xs font-medium truncate max-w-full">
              {piece.name}
            </div>
            {piece.style && (
              <div className="text-[10px] text-muted-foreground">
                {piece.style}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">
            No pieces yet
          </div>
        )}
      </div>
      {piece && (
        <a
          href={`${base}pottery/piece/${piece.id}`}
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
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
          <a
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-primary hover:underline truncate"
          >
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

// ── Configurable: RSS Feed ────────────────────────────────────────────────────
interface RssFeedItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  relativeDate?: string;
}
interface RssFeedData {
  feedTitle: string;
  items: RssFeedItem[];
}

const RSS_URL = `${base}api/hub/rss`.replace(/\/\//g, "/");

/**
 * A configurable RSS/Atom feed widget. The user sets a custom title and feed
 * URL via the gear icon; config is persisted by the parent through `onUpdate`.
 * The API server proxies the actual fetch to avoid browser CORS restrictions.
 */
export function RssFeedWidget({
  iid,
  title,
  url,
  onUpdate,
}: {
  iid: string;
  title: string;
  url: string;
  onUpdate: (config: { title?: string; url?: string }) => void;
}) {
  const [configOpen, setConfigOpen] = useState(!url);
  const [editTitle, setEditTitle] = useState(title);
  const [editUrl, setEditUrl] = useState(url);
  const [feed, setFeed] = useState<RssFeedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | undefined>(undefined);

  // Sync local edit state when parent updates (e.g. after server hydration)
  useEffect(() => {
    setEditTitle(title);
  }, [title]);
  useEffect(() => {
    setEditUrl(url);
  }, [url]);

  // Auto-close config if we now have a URL
  useEffect(() => {
    if (url && configOpen && !error) {
      // keep config open if there was an error so user can fix the URL
    }
  }, [url, configOpen, error]);

  const fetchFeed = (feedUrl: string) => {
    if (!feedUrl) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);

    fetch(`${RSS_URL}?url=${encodeURIComponent(feedUrl)}`, {
      credentials: "include",
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<RssFeedData>;
      })
      .then((data) => {
        setFeed(data);
        setLoading(false);
        setConfigOpen(false);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load feed");
        setLoading(false);
      });
  };

  // Fetch on mount (and when url changes) if we have a URL
  useEffect(() => {
    if (url && !configOpen) fetchFeed(url);
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const handleSave = () => {
    const trimmedUrl = editUrl.trim();
    const trimmedTitle = editTitle.trim();
    onUpdate({ title: trimmedTitle, url: trimmedUrl });
    if (trimmedUrl) fetchFeed(trimmedUrl);
  };

  const displayTitle = title || "RSS Feed";

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-0">
          <Rss className="w-4 h-4 text-orange-500 flex-shrink-0" />
          <span className="truncate">{displayTitle}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {url && !configOpen && (
            <button
              onClick={() => fetchFeed(url)}
              className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
              title="Refresh feed"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={() => setConfigOpen((o) => !o)}
            className={`p-1 rounded transition-colors ${
              configOpen
                ? "bg-primary/10 text-primary"
                : "hover:bg-muted text-muted-foreground"
            }`}
            title={configOpen ? "Close settings" : "Configure feed"}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Config panel */}
      {configOpen && (
        <div className="space-y-2 pt-0.5">
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
              Widget name
            </label>
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="e.g. Pottery News"
              className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
              Feed URL
            </label>
            <input
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              placeholder="https://example.com/feed.xml"
              className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm font-mono placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
          </div>
          {error && (
            <div className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex gap-2 pt-0.5">
            <button
              onClick={handleSave}
              disabled={!editUrl.trim()}
              className="flex-1 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40 hover:bg-primary/90 transition-colors"
            >
              {loading ? "Loading…" : "Save & load"}
            </button>
            {url && (
              <button
                onClick={() => {
                  setConfigOpen(false);
                  setError(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {/* Feed content */}
      {!configOpen && (
        <>
          {loading && (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              <span className="text-xs">Loading feed…</span>
            </div>
          )}
          {error && !loading && (
            <div className="space-y-2">
              <div className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
              <button
                onClick={() => setConfigOpen(true)}
                className="text-xs text-primary underline"
              >
                Fix URL in settings
              </button>
            </div>
          )}
          {!loading && !error && feed && (
            <ul className="space-y-2">
              {feed.items.slice(0, 5).map((item, i) => (
                <li key={`${iid}-${i}`}>
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-1.5 hover:text-primary transition-colors"
                  >
                    <ExternalLink className="w-3 h-3 mt-0.5 flex-shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium leading-snug line-clamp-2 group-hover:underline">
                        {item.title || "Untitled"}
                      </div>
                      {item.relativeDate && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {item.relativeDate}
                        </div>
                      )}
                    </div>
                  </a>
                </li>
              ))}
              {feed.items.length === 0 && (
                <li className="text-xs text-muted-foreground">
                  No items in feed.
                </li>
              )}
            </ul>
          )}
          {!loading && !error && !feed && !url && (
            <p className="text-xs text-muted-foreground">
              Click the gear icon to set a feed URL.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Live: Travel Stats ────────────────────────────────────────────────────────
export function TravelStatsWidget() {
  const { data: stats } = useGetTravelsStats();
  const items = [
    {
      v: stats?.totalTrips != null ? String(stats.totalTrips) : "—",
      l: "Trips",
    },
    {
      v:
        stats?.uniqueDestinations != null
          ? String(stats.uniqueDestinations)
          : "—",
      l: "Destinations",
    },
    {
      v: stats?.completedTrips != null ? String(stats.completedTrips) : "—",
      l: "Completed",
    },
    {
      v: stats?.upcomingTrips != null ? String(stats.upcomingTrips) : "—",
      l: "Upcoming",
    },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1.5">
        {items.map((s) => (
          <div
            key={s.l}
            className="bg-sky-50 dark:bg-sky-900/20 rounded-lg p-2 text-center"
          >
            <div className="text-lg font-bold text-sky-700 dark:text-sky-300">
              {s.v}
            </div>
            <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide leading-tight mt-0.5">
              {s.l}
            </div>
          </div>
        ))}
      </div>
      <a
        href={`${base}travels/`}
        className="flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
      >
        Open travels <ArrowRight className="w-3 h-3" />
      </a>
    </div>
  );
}

// ── Live: Next Trip ───────────────────────────────────────────────────────────
export function NextTripWidget() {
  const { data: stats } = useGetTravelsStats();
  const next = stats?.nextTrip ?? null;

  const daysAway = next?.startDate
    ? Math.max(
        0,
        Math.ceil(
          (new Date(next.startDate).getTime() - Date.now()) / 86_400_000,
        ),
      )
    : null;

  const dateLabel = next?.startDate
    ? new Date(next.startDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  if (!next) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground italic">
          No upcoming trips planned.
        </p>
        <a
          href={`${base}travels/trips`}
          className="flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
        >
          <Plane className="w-3 h-3" /> Plan a trip
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center flex-shrink-0">
          <Plane className="w-5 h-5 text-sky-600 dark:text-sky-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">
            {next.destination.split(",")[0]}
          </div>
          <div className="text-[10px] text-muted-foreground">{dateLabel}</div>
        </div>
        {daysAway !== null && (
          <div className="text-center flex-shrink-0">
            <div className="text-2xl font-bold text-sky-600 dark:text-sky-400 tabular-nums leading-none">
              {daysAway === 0 ? "Today" : daysAway}
            </div>
            {daysAway > 0 && (
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide">
                days
              </div>
            )}
          </div>
        )}
      </div>
      <a
        href={`${base}travels/trips`}
        className="flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
      >
        View all trips <ArrowRight className="w-3 h-3" />
      </a>
    </div>
  );
}

// ── Live: Trip Reminders ──────────────────────────────────────────────────────
export function TripRemindersWidget() {
  const { data: reminders = [] } = useListAllReminders();

  const upcoming = reminders
    .filter((r) => !r.done)
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    })
    .slice(0, 4);

  return (
    <div className="space-y-2">
      {upcoming.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          No pending reminders.
        </p>
      )}
      {upcoming.map((r) => {
        const dateStr = r.dueDate
          ? new Date(r.dueDate).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })
          : null;
        return (
          <div key={r.id} className="flex items-center gap-2 text-sm">
            <Bell className="w-3 h-3 text-sky-500 flex-shrink-0" />
            <span className="flex-1 truncate text-xs">{r.title}</span>
            {dateStr && (
              <span className="text-[10px] text-muted-foreground flex-shrink-0 whitespace-nowrap">
                {dateStr}
              </span>
            )}
          </div>
        );
      })}
      <a
        href={`${base}travels/`}
        className="flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
      >
        <Bell className="w-3 h-3" /> All reminders
      </a>
    </div>
  );
}

// ── Live: Travel Wishlist ─────────────────────────────────────────────────────
export function TravelWishlistWidget() {
  const { data: wishlist = [] } = useListWishlist();
  const pending = wishlist.filter((w) => !w.done).slice(0, 5);

  return (
    <div className="space-y-2">
      {pending.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          Your wishlist is empty.
        </p>
      )}
      {pending.map((w) => {
        const yearStr = w.targetDate
          ? new Date(w.targetDate).getFullYear().toString()
          : null;
        return (
          <div key={w.id} className="flex items-center gap-2">
            <MapPin className="w-3 h-3 text-sky-500 flex-shrink-0" />
            <span className="flex-1 text-xs truncate">{w.destination}</span>
            {yearStr && (
              <span className="text-[10px] text-muted-foreground flex-shrink-0">
                {yearStr}
              </span>
            )}
          </div>
        );
      })}
      <div className="flex items-center justify-between pt-0.5">
        <a
          href={`${base}travels/wishlist`}
          className="flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
        >
          <List className="w-3 h-3" /> View wishlist
        </a>
        {wishlist.length > 5 && (
          <span className="text-[10px] text-muted-foreground">
            +{wishlist.length - 5} more
          </span>
        )}
      </div>
    </div>
  );
}
