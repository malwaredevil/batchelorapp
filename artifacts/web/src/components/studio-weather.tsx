import { useEffect, useState } from "react";
import {
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudDrizzle,
  CloudFog,
  CloudSun,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const LAT = 48.7164;
const LON = 9.6503;
const CITY = "Reichenbach a.d. Fils";

type WeatherState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; temp: number; desc: string; Icon: LucideIcon };

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

export function StudioWeather() {
  const [state, setState] = useState<WeatherState>({ status: "loading" });

  useEffect(() => {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${LAT}&longitude=${LON}` +
      `&current=temperature_2m,weather_code` +
      `&temperature_unit=celsius`;

    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const temp = Math.round(data.current.temperature_2m as number);
        const { desc, Icon } = interpretCode(data.current.weather_code as number);
        setState({ status: "ok", temp, desc, Icon });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div className="flex items-end justify-between">
        <div className="space-y-1">
          <div className="h-9 w-16 rounded bg-muted animate-pulse" />
          <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        </div>
        <Cloud className="w-10 h-10 text-muted-foreground/30 animate-pulse" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex items-end justify-between">
        <div>
          <div className="text-3xl font-bold text-foreground">—°</div>
          <div className="text-sm text-muted-foreground">{CITY}</div>
        </div>
        <Cloud className="w-10 h-10 text-muted-foreground/60" />
      </div>
    );
  }

  const { temp, desc, Icon } = state;
  return (
    <div className="flex items-end justify-between">
      <div>
        <div className="text-3xl font-bold text-foreground">{temp}°</div>
        <div className="text-sm text-muted-foreground">
          {desc} · {CITY}
        </div>
      </div>
      <Icon className="w-10 h-10 text-muted-foreground/60" />
    </div>
  );
}
