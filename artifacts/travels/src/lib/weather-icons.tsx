import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface WeatherVisual {
  emoji: string;
  bg: string;
}

interface WeatherRule extends WeatherVisual {
  match: RegExp;
}

// Ordered rules — first match wins. Matched against the human-readable
// condition description returned by the weather API (e.g. "Light rain",
// "Partly cloudy", "Thunderstorm"). Each entry pairs a cutesy flat-style
// weather emoji with a soft pastel badge background so conditions are easy
// to tell apart at a glance, standardized across the whole app.
const RULES: WeatherRule[] = [
  { match: /thunder|storm/i, emoji: "⛈️", bg: "bg-indigo-100 dark:bg-indigo-950/50" },
  { match: /snow|sleet|blizzard|flurr/i, emoji: "❄️", bg: "bg-sky-100 dark:bg-sky-950/50" },
  { match: /drizzle/i, emoji: "🌦️", bg: "bg-blue-100 dark:bg-blue-950/50" },
  { match: /rain|shower/i, emoji: "🌧️", bg: "bg-blue-100 dark:bg-blue-950/50" },
  { match: /fog|mist|haze/i, emoji: "🌫️", bg: "bg-slate-100 dark:bg-slate-800/50" },
  { match: /wind|breez|gale/i, emoji: "🌬️", bg: "bg-teal-100 dark:bg-teal-950/50" },
  { match: /partly|partial|scattered/i, emoji: "⛅", bg: "bg-amber-50 dark:bg-amber-950/30" },
  { match: /cloud|overcast/i, emoji: "☁️", bg: "bg-slate-100 dark:bg-slate-800/50" },
  { match: /clear|sun/i, emoji: "☀️", bg: "bg-amber-100 dark:bg-amber-950/30" },
];

const DEFAULT_VISUAL: WeatherVisual = { emoji: "☁️", bg: "bg-slate-100 dark:bg-slate-800/50" };

function getWeatherVisual(conditionDescription: string | null | undefined): WeatherVisual {
  if (!conditionDescription) return DEFAULT_VISUAL;
  const rule = RULES.find((r) => r.match.test(conditionDescription));
  return rule ?? DEFAULT_VISUAL;
}

/**
 * Standardized cutesy weather icon: a soft pastel circular badge with a
 * flat-style weather emoji, plus a hover tooltip showing the full condition
 * text. Use this everywhere a weather condition needs to be shown instead of
 * rolling a one-off icon so the look stays consistent across the app.
 */
export function WeatherIcon({
  condition,
  size = 36,
  className,
}: {
  condition: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const visual = getWeatherVisual(condition);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={condition ?? "Weather unknown"}
          className={cn(
            "inline-flex shrink-0 select-none items-center justify-center rounded-full leading-none cursor-default",
            visual.bg,
            className,
          )}
          style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
        >
          {visual.emoji}
        </span>
      </TooltipTrigger>
      <TooltipContent>{condition ?? "Unknown conditions"}</TooltipContent>
    </Tooltip>
  );
}

export function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

/** Formats a max/min pair as "31° / 23°C" — returns null if both are missing. */
export function formatTempRangeC(maxC: number | null | undefined, minC: number | null | undefined): string | null {
  if (maxC == null && minC == null) return null;
  const max = maxC != null ? `${Math.round(maxC)}°` : "—";
  const min = minC != null ? ` / ${Math.round(minC)}°` : "";
  return `${max}${min}C`;
}

export function formatTempRangeF(maxC: number | null | undefined, minC: number | null | undefined): string | null {
  if (maxC == null && minC == null) return null;
  const max = maxC != null ? `${celsiusToFahrenheit(maxC)}°` : "—";
  const min = minC != null ? ` / ${celsiusToFahrenheit(minC)}°` : "";
  return `${max}${min}F`;
}
