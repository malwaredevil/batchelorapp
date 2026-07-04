import { useEffect, useRef, useState } from "react";
import {
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudDrizzle,
  CloudFog,
  CloudSun,
  Settings,
  MapPin,
  Loader2,
  Search,
  Check,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface WeatherConfig {
  city: string;
  country: string;
  lat: number;
  lon: number;
  unit: "celsius" | "fahrenheit";
}

type WeatherState =
  | { status: "loading" }
  | { status: "error"; msg?: string }
  | { status: "ok"; temp: number; desc: string; Icon: LucideIcon };

interface GeoResult {
  id: number;
  name: string;
  country: string;
  admin1?: string;
  latitude: number;
  longitude: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const base = import.meta.env.BASE_URL as string;
const WEATHER_CONFIG_URL = `${base}api/hub/weather-config`.replace(
  /\/\//g,
  "/",
);
const WEATHER_LS_KEY = "batchelor-weather-config";

// ── Helpers ───────────────────────────────────────────────────────────────────
function interpretCode(code: number): { desc: string; Icon: LucideIcon } {
  if (code === 0) return { desc: "Clear", Icon: Sun };
  if (code === 1) return { desc: "Mainly Clear", Icon: Sun };
  if (code === 2) return { desc: "Partly Cloudy", Icon: CloudSun };
  if (code === 3) return { desc: "Overcast", Icon: Cloud };
  if (code === 45 || code === 48) return { desc: "Foggy", Icon: CloudFog };
  if (code >= 51 && code <= 55) return { desc: "Drizzle", Icon: CloudDrizzle };
  if (code >= 61 && code <= 65) return { desc: "Rainy", Icon: CloudRain };
  if (code >= 71 && code <= 77) return { desc: "Snowy", Icon: CloudSnow };
  if (code >= 80 && code <= 82) return { desc: "Showers", Icon: CloudRain };
  if (code >= 95) return { desc: "Thunderstorm", Icon: CloudLightning };
  return { desc: "Cloudy", Icon: Cloud };
}

function readLocalConfig(): WeatherConfig | null {
  try {
    const raw = window.localStorage.getItem(WEATHER_LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WeatherConfig;
  } catch {
    return null;
  }
}

function writeLocalConfig(cfg: WeatherConfig) {
  try {
    window.localStorage.setItem(WEATHER_LS_KEY, JSON.stringify(cfg));
  } catch {
    /* quota */
  }
}

async function fetchServerConfig(): Promise<WeatherConfig | null> {
  try {
    const res = await fetch(WEATHER_CONFIG_URL, { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as { config?: WeatherConfig | null };
    return data.config ?? null;
  } catch {
    return null;
  }
}

async function saveServerConfig(cfg: WeatherConfig): Promise<void> {
  try {
    await fetch(WEATHER_CONFIG_URL, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
  } catch {
    /* silent */
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export function StudioWeather() {
  const [config, setConfig] = useState<WeatherConfig | null>(readLocalConfig);
  const [weather, setWeather] = useState<WeatherState>({ status: "loading" });
  const [configOpen, setConfigOpen] = useState(false);

  // Config form state
  const [query, setQuery] = useState("");
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [pendingUnit, setPendingUnit] = useState<"celsius" | "fahrenheit">(
    "celsius",
  );

  const weatherAbort = useRef<AbortController | undefined>(undefined);
  const geoAbort = useRef<AbortController | undefined>(undefined);
  const geoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Hydrate config from server on mount
  useEffect(() => {
    fetchServerConfig().then((serverCfg) => {
      if (serverCfg) {
        setConfig(serverCfg);
        writeLocalConfig(serverCfg);
      } else if (!config) {
        // No config anywhere — open setup automatically
        setConfigOpen(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When config panel opens, initialise form values
  useEffect(() => {
    if (configOpen) {
      setQuery(config ? `${config.city}, ${config.country}` : "");
      setGeoResults([]);
      setPendingUnit(config?.unit ?? "celsius");
    }
  }, [configOpen, config]);

  // Fetch weather whenever config changes
  useEffect(() => {
    if (!config) {
      setWeather({ status: "error", msg: "No location set" });
      return;
    }
    weatherAbort.current?.abort();
    const ctrl = new AbortController();
    weatherAbort.current = ctrl;
    setWeather({ status: "loading" });

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${config.lat}&longitude=${config.lon}` +
      `&current=temperature_2m,weather_code` +
      `&temperature_unit=${config.unit}`;

    fetch(url, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data) => {
        const d = data as {
          current: { temperature_2m: number; weather_code: number };
        };
        const temp = Math.round(d.current.temperature_2m);
        const { desc, Icon } = interpretCode(d.current.weather_code);
        setWeather({ status: "ok", temp, desc, Icon });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setWeather({ status: "error" });
      });

    return () => ctrl.abort();
  }, [config]);

  // Debounced city geocode search
  useEffect(() => {
    clearTimeout(geoTimer.current);
    const q = query.trim();
    if (q.length < 2) {
      setGeoResults([]);
      return;
    }
    geoTimer.current = setTimeout(() => {
      geoAbort.current?.abort();
      const ctrl = new AbortController();
      geoAbort.current = ctrl;
      setGeoLoading(true);

      fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`,
        { signal: ctrl.signal },
      )
        .then((r) => r.json())
        .then((data) => {
          const d = data as { results?: GeoResult[] };
          setGeoResults(d.results ?? []);
          setGeoLoading(false);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          setGeoLoading(false);
        });
    }, 350);

    return () => {
      clearTimeout(geoTimer.current);
      geoAbort.current?.abort();
    };
  }, [query]);

  const selectCity = (geo: GeoResult) => {
    const newCfg: WeatherConfig = {
      city: geo.name,
      country: geo.country ?? "",
      lat: geo.latitude,
      lon: geo.longitude,
      unit: pendingUnit,
    };
    setConfig(newCfg);
    writeLocalConfig(newCfg);
    void saveServerConfig(newCfg);
    setConfigOpen(false);
    setGeoResults([]);
    setQuery("");
  };

  const saveUnitChange = (unit: "celsius" | "fahrenheit") => {
    setPendingUnit(unit);
    if (config) {
      const newCfg = { ...config, unit };
      setConfig(newCfg);
      writeLocalConfig(newCfg);
      void saveServerConfig(newCfg);
    }
  };

  const unitLabel = config?.unit === "fahrenheit" ? "°F" : "°C";
  const locationLabel = config
    ? `${config.city}${config.country ? `, ${config.country}` : ""}`
    : null;

  return (
    <div className="space-y-3">
      {/* Config panel */}
      {configOpen && (
        <div className="space-y-2.5 pt-0.5">
          {/* City search */}
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
              Location
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              {geoLoading && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />
              )}
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search city…"
                autoFocus
                className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>

            {/* Search results */}
            {geoResults.length > 0 && (
              <div className="mt-1 rounded-lg border border-border bg-card overflow-hidden shadow-sm">
                {geoResults.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => selectCity(g)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/60 transition-colors text-sm border-b border-border last:border-0"
                  >
                    <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    <span className="font-medium truncate">{g.name}</span>
                    {g.admin1 && (
                      <span className="text-muted-foreground text-xs truncate">
                        {g.admin1}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground flex-shrink-0">
                      {g.country}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Unit toggle */}
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
              Temperature unit
            </label>
            <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
              <button
                onClick={() => saveUnitChange("celsius")}
                className={`flex-1 py-1.5 transition-colors ${
                  pendingUnit === "celsius"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                °C — Celsius
              </button>
              <button
                onClick={() => saveUnitChange("fahrenheit")}
                className={`flex-1 py-1.5 transition-colors border-l border-border ${
                  pendingUnit === "fahrenheit"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                °F — Fahrenheit
              </button>
            </div>
          </div>

          {config && (
            <button
              onClick={() => {
                setConfigOpen(false);
                setGeoResults([]);
              }}
              className="w-full py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Weather display */}
      {!configOpen && (
        <>
          {weather.status === "loading" && (
            <div className="flex items-end justify-between">
              <div className="space-y-1">
                <div className="h-9 w-16 rounded bg-muted animate-pulse" />
                <div className="h-4 w-32 rounded bg-muted animate-pulse" />
              </div>
              <Cloud className="w-10 h-10 text-muted-foreground/30 animate-pulse" />
            </div>
          )}

          {weather.status === "error" && (
            <div className="flex items-end justify-between">
              <div>
                <div className="text-3xl font-bold text-foreground">—°</div>
                <div className="text-sm text-muted-foreground">
                  {locationLabel ?? "Set a location →"}
                </div>
              </div>
              <Cloud className="w-10 h-10 text-muted-foreground/60" />
            </div>
          )}

          {weather.status === "ok" && (
            <div className="flex items-end justify-between">
              <div>
                <div className="text-3xl font-bold text-foreground">
                  {weather.temp}
                  {unitLabel}
                </div>
                <div className="text-sm text-muted-foreground">
                  {weather.desc}
                  {locationLabel && ` · ${locationLabel}`}
                </div>
              </div>
              <weather.Icon className="w-10 h-10 text-muted-foreground/60" />
            </div>
          )}
        </>
      )}

      {/* Footer row: gear + refresh */}
      <div className="flex items-center justify-between pt-0.5">
        <button
          onClick={() => setConfigOpen((o) => !o)}
          className={`flex items-center gap-1 text-[10px] font-medium transition-colors ${
            configOpen
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {configOpen ? (
            <>
              <Check className="w-3 h-3" /> Searching…
            </>
          ) : (
            <>
              <Settings className="w-3 h-3" /> Change location
            </>
          )}
        </button>
        {!configOpen && config && weather.status !== "loading" && (
          <button
            onClick={() => {
              // Re-trigger weather fetch by briefly nulling then restoring
              setWeather({ status: "loading" });
              setConfig((c) => (c ? { ...c } : c));
            }}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
