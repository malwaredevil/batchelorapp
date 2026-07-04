import {
  Sun,
  Cloud,
  CloudSun,
  CloudRain,
  CloudDrizzle,
  CloudSnow,
  CloudLightning,
  CloudFog,
  Wind,
  type LucideIcon,
} from "lucide-react";

interface WeatherIconRule {
  match: RegExp;
  icon: LucideIcon;
}

// Ordered rules — first match wins. Matched against the human-readable
// condition description returned by the weather API (e.g. "Light rain",
// "Partly cloudy", "Thunderstorm").
const RULES: WeatherIconRule[] = [
  { match: /thunder|storm/i, icon: CloudLightning },
  { match: /snow|sleet|blizzard|flurr/i, icon: CloudSnow },
  { match: /drizzle/i, icon: CloudDrizzle },
  { match: /rain|shower/i, icon: CloudRain },
  { match: /fog|mist|haze/i, icon: CloudFog },
  { match: /wind|breez|gale/i, icon: Wind },
  { match: /partly|partial|scattered/i, icon: CloudSun },
  { match: /cloud|overcast/i, icon: Cloud },
  { match: /clear|sun/i, icon: Sun },
];

export function getWeatherIcon(conditionDescription: string | null | undefined): LucideIcon {
  if (!conditionDescription) return Cloud;
  const rule = RULES.find((r) => r.match.test(conditionDescription));
  return rule?.icon ?? Cloud;
}
