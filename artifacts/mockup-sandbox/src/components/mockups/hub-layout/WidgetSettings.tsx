import { useState } from "react";
import {
  Settings, X, Check, ChevronDown, Wind, BookOpen, Globe, Rss,
  ShoppingBag, Star, Activity, Package, Shirt, MapPin, Thermometer,
  AlignLeft, Hash, Link, RefreshCw, Eye, EyeOff, Trash2,
  Bell, ToggleLeft, ToggleRight, Sliders, Save, ArrowLeft
} from "lucide-react";

type PanelWidget = "weather" | "rss" | "website" | "etsy" | null;

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${value ? "bg-primary" : "bg-muted-foreground/30"}`}>
      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? "translate-x-5" : "translate-x-1"}`} />
    </button>
  );
}

function Input({ label, value, onChange, placeholder, type = "text", hint }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      <div className="relative">
        <select
          value={value} onChange={e => onChange(e.target.value)}
          className="w-full appearance-none px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        >
          {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
      </div>
    </div>
  );
}

function SaveBanner() {
  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-900/20 border-t border-emerald-200 dark:border-emerald-800">
      <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
      <span className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">Settings saved automatically</span>
      <span className="text-xs text-emerald-600/70 dark:text-emerald-500">· synced to your account</span>
    </div>
  );
}

function WeatherPanel({ onClose }: { onClose: () => void }) {
  const [location, setLocation] = useState("Reichenbach a.d. Fils, DE");
  const [units, setUnits] = useState("C");
  const [showHumidity, setShowHumidity] = useState(true);
  const [showWind, setShowWind] = useState(true);
  const [showUV, setShowUV] = useState(false);
  const [refresh, setRefresh] = useState("15");
  const [saved, setSaved] = useState(false);

  function save() { setSaved(true); setTimeout(() => setSaved(false), 2500); }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><ArrowLeft className="w-4 h-4" /></button>
        <div className="w-7 h-7 rounded-lg bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center">
          <Wind className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
        </div>
        <div>
          <div className="text-sm font-semibold">Studio Weather</div>
          <div className="text-xs text-muted-foreground">Widget settings</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <section className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Location</div>
          <Input label="City name or zip code" value={location} onChange={setLocation} placeholder="e.g. 94102 or Paris, FR" hint="Used to fetch current conditions from Open-Meteo (no API key needed)." />
          <button className="flex items-center gap-1.5 text-xs text-primary hover:underline">
            <MapPin className="w-3 h-3" /> Use my current location
          </button>
        </section>

        <section className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Display</div>
          <div>
            <div className="text-xs font-medium mb-2">Temperature units</div>
            <div className="flex gap-2">
              {["C", "F"].map(u => (
                <button key={u} onClick={() => setUnits(u)} className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${units === u ? "bg-primary text-primary-foreground border-transparent" : "border-border text-muted-foreground hover:bg-muted"}`}>
                  °{u}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2.5">
            {[
              { l: "Show humidity", v: showHumidity, s: setShowHumidity },
              { l: "Show wind speed", v: showWind, s: setShowWind },
              { l: "Show UV index", v: showUV, s: setShowUV },
            ].map(item => (
              <div key={item.l} className="flex items-center justify-between">
                <span className="text-sm">{item.l}</span>
                <Toggle value={item.v} onChange={item.s} />
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Refresh</div>
          <Select label="Auto-refresh every" value={refresh} onChange={setRefresh} options={[
            { v: "5", l: "5 minutes" }, { v: "15", l: "15 minutes" }, { v: "30", l: "30 minutes" }, { v: "60", l: "1 hour" }, { v: "0", l: "Manual only" }
          ]} />
        </section>
      </div>
      <div className="p-4 border-t border-border flex gap-2">
        <button onClick={save} className="flex-1 bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
          <Save className="w-3.5 h-3.5" /> Save settings
        </button>
        <button className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      {saved && <SaveBanner />}
    </div>
  );
}

function RssPanel({ onClose }: { onClose: () => void }) {
  const [feedUrl, setFeedUrl] = useState("https://blog.ravelry.com/feed/");
  const [itemCount, setItemCount] = useState("5");
  const [showImages, setShowImages] = useState(true);
  const [showDates, setShowDates] = useState(true);
  const [saved, setSaved] = useState(false);

  function save() { setSaved(true); setTimeout(() => setSaved(false), 2500); }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><ArrowLeft className="w-4 h-4" /></button>
        <div className="w-7 h-7 rounded-lg bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center">
          <Rss className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
        </div>
        <div>
          <div className="text-sm font-semibold">RSS / News Feed</div>
          <div className="text-xs text-muted-foreground">Widget settings</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <section className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Feed source</div>
          <Input label="RSS feed URL" value={feedUrl} onChange={setFeedUrl} placeholder="https://example.com/feed.xml" hint="Paste any RSS or Atom feed URL." />
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground mb-1">Popular feeds</div>
            {[
              { l: "Ravelry Blog", u: "https://blog.ravelry.com/feed/" },
              { l: "Make Magazine", u: "https://makezine.com/feed/" },
              { l: "Pottery Making Illustrated", u: "https://ceramicstoday.com/feed/" },
            ].map(f => (
              <button key={f.l} onClick={() => setFeedUrl(f.u)} className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-muted text-left transition-colors">
                <Rss className="w-3 h-3 text-orange-400 flex-shrink-0" />
                <span className="text-xs font-medium">{f.l}</span>
                <span className="text-xs text-muted-foreground truncate flex-1">{f.u}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Display</div>
          <Select label="Number of items to show" value={itemCount} onChange={setItemCount} options={[
            { v: "3", l: "3 items" }, { v: "5", l: "5 items" }, { v: "10", l: "10 items" },
          ]} />
          {[
            { l: "Show article images", v: showImages, s: setShowImages },
            { l: "Show publish dates", v: showDates, s: setShowDates },
          ].map(item => (
            <div key={item.l} className="flex items-center justify-between">
              <span className="text-sm">{item.l}</span>
              <Toggle value={item.v} onChange={item.s} />
            </div>
          ))}
        </section>
      </div>
      <div className="p-4 border-t border-border flex gap-2">
        <button onClick={save} className="flex-1 bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
          <Save className="w-3.5 h-3.5" /> Save settings
        </button>
        <button className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      {saved && <SaveBanner />}
    </div>
  );
}

function WebsitePanel({ onClose, type }: { onClose: () => void; type: "etsy" | "website" }) {
  const [url, setUrl] = useState(type === "etsy" ? "https://www.etsy.com/shop/MyCeramicsShop" : "https://example.com");
  const [title, setTitle] = useState(type === "etsy" ? "My Etsy Shop" : "My Favourite Site");
  const [showPreview, setShowPreview] = useState(true);
  const [saved, setSaved] = useState(false);

  function save() { setSaved(true); setTimeout(() => setSaved(false), 2500); }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><ArrowLeft className="w-4 h-4" /></button>
        <div className="w-7 h-7 rounded-lg bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center">
          <Globe className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
        </div>
        <div>
          <div className="text-sm font-semibold">{type === "etsy" ? "Etsy Shop" : "Website Bookmark"}</div>
          <div className="text-xs text-muted-foreground">Widget settings</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <section className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Link</div>
          <Input label="Widget title" value={title} onChange={setTitle} placeholder="My Shop" />
          <Input label="URL" value={url} onChange={setUrl} placeholder="https://..." hint={type === "etsy" ? "Paste your Etsy shop, search, or favourite listing URL." : "Any public website URL. Note: some sites block embedding."} />
        </section>
        <section className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Display</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">Show live preview</div>
              <div className="text-xs text-muted-foreground">Embed the page in the widget (if the site allows it)</div>
            </div>
            <Toggle value={showPreview} onChange={setShowPreview} />
          </div>
          {!showPreview && (
            <div className="bg-muted/40 rounded-lg px-3 py-2 text-xs text-muted-foreground">
              Widget will show as a clickable link card instead.
            </div>
          )}
        </section>
      </div>
      <div className="p-4 border-t border-border flex gap-2">
        <button onClick={save} className="flex-1 bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
          <Save className="w-3.5 h-3.5" /> Save settings
        </button>
        <button className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      {saved && <SaveBanner />}
    </div>
  );
}

const SAMPLE_WIDGETS = [
  { id: "weather", label: "Studio Weather", icon: Wind, sub: "17°C · Partly cloudy · Reichenbach", accent: "bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400", panel: "weather" as PanelWidget },
  { id: "rss", label: "RSS Feed", icon: Rss, sub: "Ravelry Blog · 5 items", accent: "bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400", panel: "rss" as PanelWidget },
  { id: "etsy", label: "Etsy Shop", icon: ShoppingBag, sub: "MyCeramicsShop · live preview", accent: "bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400", panel: "etsy" as PanelWidget },
  { id: "website", label: "Website Bookmark", icon: Globe, sub: "example.com · link card", accent: "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400", panel: "website" as PanelWidget },
];

export default function WidgetSettings() {
  const [activePanel, setActivePanel] = useState<PanelWidget>(null);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans p-6 flex items-start justify-center gap-6">
      {/* Left: widget list showing gear icon */}
      <div className="w-80 flex-shrink-0 space-y-4">
        <div>
          <h2 className="text-base font-bold">Widget settings</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Click the ⚙ icon on any widget to configure it. Settings sync to your account and persist across devices.</p>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
          {SAMPLE_WIDGETS.map(w => (
            <div key={w.id} className={`flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors ${activePanel === w.panel ? "bg-primary/5" : ""}`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${w.accent}`}>
                <w.icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{w.label}</div>
                <div className="text-xs text-muted-foreground truncate">{w.sub}</div>
              </div>
              <button
                onClick={() => setActivePanel(activePanel === w.panel ? null : w.panel)}
                className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${activePanel === w.panel ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Persistence callout */}
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3.5 flex gap-3">
          <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Settings are saved to your account</div>
            <div className="text-xs text-emerald-600/80 dark:text-emerald-500 mt-0.5">Widget positions, preferences, and custom URLs persist across sessions and devices. You never have to reset them.</div>
          </div>
        </div>
      </div>

      {/* Right: settings panel */}
      <div className="w-80 flex-shrink-0 bg-card border border-border rounded-xl overflow-hidden h-[600px]">
        {activePanel === null && (
          <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
              <Sliders className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <div className="text-sm font-semibold">Select a widget</div>
              <div className="text-xs text-muted-foreground mt-1">Click the ⚙ icon next to any widget to see its settings here.</div>
            </div>
          </div>
        )}
        {activePanel === "weather" && <WeatherPanel onClose={() => setActivePanel(null)} />}
        {activePanel === "rss" && <RssPanel onClose={() => setActivePanel(null)} />}
        {activePanel === "etsy" && <WebsitePanel onClose={() => setActivePanel(null)} type="etsy" />}
        {activePanel === "website" && <WebsitePanel onClose={() => setActivePanel(null)} type="website" />}
      </div>
    </div>
  );
}
