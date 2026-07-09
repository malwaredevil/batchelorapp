import { MapPin, Star, Wind, Leaf, ArrowRight, Table2, Image as ImageIcon, ExternalLink } from "lucide-react";

// ── Widget type definitions ─────────────────────────────────────────────────

export interface WeatherDay {
  date: string;
  conditionDescription: string;
  maxTempC: number | null;
  minTempC: number | null;
  precipitationChancePercent: number | null;
}

export interface PlaceResult {
  id: string;
  name: string;
  address: string;
  rating: number | null;
  userRatingCount: number | null;
  lat: number | null;
  lng: number | null;
  googleMapsUri: string | null;
  websiteUri: string | null;
}

export interface AirQualityData {
  aqi: number;
  category: string;
  dominantPollutant: string;
  locationName: string;
}

export interface PollenData {
  date: string;
  overallCategory: string;
  locationName: string;
  types: Array<{ displayName: string; category: string }>;
}

export interface DataCardRow {
  label: string;
  value: string;
}

export interface ChatWidgetImage {
  url: string;
  sourceUrl?: string;
}

export interface ExchangeRateResult {
  code: string;
  name?: string;
  rate: number;
}

export interface TripCardData {
  tripId?: number;
  name: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  countdownDays?: number;
}

export interface PotteryItemData {
  itemId?: number;
  name: string;
  imageUrl?: string;
  maker?: string;
  style?: string;
  aiDescription?: string;
  dominantColors?: string[];
}

export interface FabricSwatchData {
  fabricId?: number;
  name: string;
  manufacturer?: string;
  designer?: string;
  dominantColors?: string[];
  imageUrl?: string;
  aiDescription?: string;
}

export interface DestinationCardData {
  name: string;
  country?: string;
  highlights?: string[];
  mapsUrl: string;
}

export type ChatWidget =
  | { type: "weather"; locationName: string; days: WeatherDay[] }
  | { type: "places"; query: string; places: PlaceResult[] }
  | { type: "air_quality"; data: AirQualityData }
  | { type: "pollen"; data: PollenData }
  | { type: "data_card"; title?: string; rows: DataCardRow[] }
  | { type: "image_card"; title?: string; images: ChatWidgetImage[] }
  | { type: "exchange_rate"; from: string; to: ExchangeRateResult[]; lastUpdated: string }
  | { type: "trip_card"; trip: TripCardData }
  | { type: "pottery_item"; item: PotteryItemData }
  | { type: "fabric_swatch"; swatch: FabricSwatchData }
  | { type: "destination_card"; card: DestinationCardData };

// ── Weather condition → emoji mapping ──────────────────────────────────────

function weatherEmoji(description: string): string {
  const d = description.toLowerCase();
  if (d.includes("thunder") || d.includes("storm")) return "⛈️";
  if (d.includes("snow") || d.includes("blizzard")) return "❄️";
  if (d.includes("sleet") || d.includes("hail")) return "🌨️";
  if (d.includes("rain") || d.includes("shower") || d.includes("drizzle"))
    return "🌧️";
  if (d.includes("fog") || d.includes("mist") || d.includes("haze"))
    return "🌫️";
  if (d.includes("cloud") || d.includes("overcast")) return "☁️";
  if (d.includes("partly") || d.includes("mostly cloudy")) return "⛅";
  if (d.includes("sunny") || d.includes("clear")) return "☀️";
  return "🌤️";
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function toF(c: number) {
  return Math.round((c * 9) / 5 + 32);
}

// ── AQI colour ──────────────────────────────────────────────────────────────

function aqiColor(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("good")) return "text-green-600 bg-green-50 border-green-200";
  if (c.includes("moderate"))
    return "text-yellow-700 bg-yellow-50 border-yellow-200";
  if (c.includes("unhealthy for sensitive"))
    return "text-orange-600 bg-orange-50 border-orange-200";
  if (c.includes("unhealthy")) return "text-red-600 bg-red-50 border-red-200";
  if (c.includes("very unhealthy") || c.includes("hazardous"))
    return "text-purple-700 bg-purple-50 border-purple-200";
  return "text-foreground bg-muted border-border";
}

function pollenColor(category: string): string {
  const c = category.toLowerCase();
  if (c === "none" || c === "very low")
    return "text-green-600 bg-green-50 border-green-200";
  if (c === "low") return "text-yellow-700 bg-yellow-50 border-yellow-200";
  if (c === "moderate") return "text-orange-600 bg-orange-50 border-orange-200";
  if (c === "high" || c === "very high")
    return "text-red-600 bg-red-50 border-red-200";
  return "text-foreground bg-muted border-border";
}

// ── Star rating renderer ────────────────────────────────────────────────────

function StarRating({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3 w-3 ${
            i < full
              ? "fill-amber-400 text-amber-400"
              : i === full && half
                ? "fill-amber-200 text-amber-400"
                : "fill-none text-muted-foreground/40"
          }`}
        />
      ))}
      <span className="ml-0.5 text-xs font-semibold text-foreground">
        {rating.toFixed(1)}
      </span>
    </span>
  );
}

// ── Widget renderers ────────────────────────────────────────────────────────

function WeatherWidget({
  locationName,
  days,
}: {
  locationName: string;
  days: WeatherDay[];
}) {
  const forecastUrl = `https://www.google.com/search?q=${encodeURIComponent("weather " + locationName)}`;
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border/60 bg-sky-50/60 px-3 py-2 dark:bg-sky-950/30">
        <div className="flex items-center gap-1.5">
          <span className="text-base">🌤️</span>
          <span className="text-xs font-semibold text-foreground">
            {locationName} forecast
          </span>
        </div>
        <a
          href={forecastUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-0.5 text-xs text-sky-600 hover:text-sky-700"
          onClick={(e) => e.stopPropagation()}
        >
          Full forecast <ArrowRight className="h-3 w-3" />
        </a>
      </div>
      <div className="divide-y divide-border/50">
        {days.map((day, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2.5">
            <span className="text-xl leading-none" aria-hidden>
              {weatherEmoji(day.conditionDescription)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">
                {formatDate(day.date)}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {day.conditionDescription}
                {day.precipitationChancePercent != null &&
                  day.precipitationChancePercent > 0 && (
                    <span className="ml-1 text-sky-600">
                      💧{day.precipitationChancePercent}%
                    </span>
                  )}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-bold text-foreground">
                {day.maxTempC != null ? `${Math.round(day.maxTempC)}°` : "—"}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  /{" "}
                  {day.minTempC != null ? `${Math.round(day.minTempC)}°` : "—"}
                  °C
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {day.maxTempC != null ? `${toF(day.maxTempC)}°` : "—"}
                {" / "}
                {day.minTempC != null ? `${toF(day.minTempC)}°` : "—"}°F
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlacesWidget({
  query,
  places,
}: {
  query: string;
  places: PlaceResult[];
}) {
  const mapsSearchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border/60 bg-emerald-50/60 px-3 py-2 dark:bg-emerald-950/30">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-emerald-600" />
          <span className="text-xs font-semibold text-foreground">{query}</span>
        </div>
        <a
          href={mapsSearchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-0.5 text-xs text-emerald-600 hover:text-emerald-700"
          onClick={(e) => e.stopPropagation()}
        >
          Maps <ArrowRight className="h-3 w-3" />
        </a>
      </div>
      <div className="divide-y divide-border/50">
        {places.slice(0, 6).map((place, i) => (
          <div key={i} className="px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                {place.googleMapsUri ? (
                  <a
                    href={place.googleMapsUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-foreground hover:text-primary"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {place.name}
                  </a>
                ) : (
                  <p className="text-xs font-semibold text-foreground">
                    {place.name}
                  </p>
                )}
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {place.address}
                </p>
              </div>
              {place.rating != null && (
                <div className="shrink-0">
                  <StarRating rating={place.rating} />
                  {place.userRatingCount != null && (
                    <p className="mt-0.5 text-right text-xs text-muted-foreground">
                      ({place.userRatingCount.toLocaleString()})
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AirQualityWidget({ data }: { data: AirQualityData }) {
  const colorClass = aqiColor(data.category);
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-border/60 bg-slate-50/60 px-3 py-2 dark:bg-slate-950/30">
        <Wind className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-xs font-semibold text-foreground">
          Air Quality — {data.locationName}
        </span>
      </div>
      <div className="flex items-center gap-3 px-3 py-3">
        <div
          className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full border-2 ${colorClass}`}
        >
          <span className="text-lg font-bold leading-none">{data.aqi}</span>
          <span className="text-[10px] font-medium leading-tight">AQI</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            {data.category}
          </p>
          <p className="text-xs text-muted-foreground">
            Dominant pollutant: {data.dominantPollutant}
          </p>
        </div>
      </div>
    </div>
  );
}

function PollenWidget({ data }: { data: PollenData }) {
  const overallColor = pollenColor(data.overallCategory);
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-border/60 bg-lime-50/60 px-3 py-2 dark:bg-lime-950/30">
        <Leaf className="h-3.5 w-3.5 text-lime-600" />
        <span className="text-xs font-semibold text-foreground">
          Pollen — {data.locationName}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {data.date}
        </span>
      </div>
      <div className="px-3 py-2.5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Overall:
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${overallColor}`}
          >
            {data.overallCategory}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.types.map((t, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                {t.displayName}:
              </span>
              <span
                className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${pollenColor(t.category)}`}
              >
                {t.category}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DataCardWidget({ title, rows }: { title?: string; rows: DataCardRow[] }) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {title && (
        <div className="flex items-center gap-1.5 border-b border-border/60 bg-violet-50/60 px-3 py-2 dark:bg-violet-950/30">
          <Table2 className="h-3.5 w-3.5 text-violet-600" />
          <span className="text-xs font-semibold text-foreground">
            {title}
          </span>
        </div>
      )}
      <div className="divide-y divide-border/50">
        {rows.map((row, i) => (
          <div
            key={i}
            className="flex items-start justify-between gap-3 px-3 py-2"
          >
            <span className="text-xs text-muted-foreground">{row.label}</span>
            <span className="text-right text-xs font-semibold text-foreground">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImageCardWidget({
  title,
  images,
}: {
  title?: string;
  images: ChatWidgetImage[];
}) {
  if (images.length === 0) return null;
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {title && (
        <div className="flex items-center gap-1.5 border-b border-border/60 bg-fuchsia-50/60 px-3 py-2 dark:bg-fuchsia-950/30">
          <ImageIcon className="h-3.5 w-3.5 text-fuchsia-600" />
          <span className="text-xs font-semibold text-foreground">
            {title}
          </span>
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto p-2">
        {images.slice(0, 4).map((img, i) =>
          img.sourceUrl ? (
            <a
              key={i}
              href={img.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0"
            >
              <img
                src={img.url}
                alt=""
                loading="lazy"
                className="h-24 w-24 rounded-lg border border-border object-cover"
              />
            </a>
          ) : (
            <img
              key={i}
              src={img.url}
              alt=""
              loading="lazy"
              className="h-24 w-24 shrink-0 rounded-lg border border-border object-cover"
            />
          ),
        )}
      </div>
    </div>
  );
}

// ── Exchange Rate Widget ─────────────────────────────────────────────────────

function ExchangeRateWidget({
  from,
  to,
  lastUpdated,
}: {
  from: string;
  to: ExchangeRateResult[];
  lastUpdated: string;
}) {
  const flag = (code: string) => {
    const offset = 127397;
    return [...code.toUpperCase()].map((c) => String.fromCodePoint(c.charCodeAt(0) + offset)).join("");
  };
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-border/60 bg-emerald-50/60 px-3 py-2 dark:bg-emerald-950/30">
        <span className="text-base">{flag(from)}</span>
        <span className="text-xs font-semibold text-foreground">Exchange Rates from {from}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{lastUpdated}</span>
      </div>
      <div className="divide-y divide-border/60">
        {to.map((r) => (
          <div key={r.code} className="flex items-center px-3 py-2">
            <span className="mr-2 text-base">{flag(r.code)}</span>
            <span className="flex-1 text-sm font-medium text-foreground">
              {r.name ?? r.code}
            </span>
            <span className="text-sm font-semibold text-foreground">
              1 {from} = {r.rate.toFixed(4)} {r.code}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Trip Card Widget ─────────────────────────────────────────────────────────

function TripCardWidget({ trip }: { trip: TripCardData }) {
  const statusColors: Record<string, string> = {
    planning: "bg-blue-100 text-blue-700",
    confirmed: "bg-green-100 text-green-700",
    ongoing: "bg-amber-100 text-amber-700",
    completed: "bg-slate-100 text-slate-600",
    cancelled: "bg-red-100 text-red-600",
  };
  const statusColor = trip.status ? (statusColors[trip.status.toLowerCase()] ?? "bg-muted text-muted-foreground") : "";
  const countdownText =
    trip.countdownDays != null
      ? trip.countdownDays < 0
        ? `${Math.abs(trip.countdownDays)}d ago`
        : trip.countdownDays === 0
        ? "Today!"
        : `${trip.countdownDays}d away`
      : null;

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-start gap-2 px-3 py-3">
        <span className="mt-0.5 text-2xl">✈️</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{trip.name}</p>
          {trip.destination && (
            <p className="text-xs text-muted-foreground">{trip.destination}</p>
          )}
          {(trip.startDate || trip.endDate) && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {trip.startDate ?? ""}
              {trip.startDate && trip.endDate ? " – " : ""}
              {trip.endDate ?? ""}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {trip.status && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusColor}`}>
              {trip.status}
            </span>
          )}
          {countdownText && (
            <span className="text-xs font-semibold text-primary">{countdownText}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Pottery Item Widget ──────────────────────────────────────────────────────

function PotteryItemWidget({ item }: { item: PotteryItemData }) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-border/60 bg-amber-50/60 px-3 py-2 dark:bg-amber-950/30">
        <span className="text-base">🏺</span>
        <span className="text-xs font-semibold text-foreground">Pottery Collection</span>
      </div>
      <div className="flex gap-3 p-3">
        {item.imageUrl && (
          <img
            src={item.imageUrl}
            alt={item.name}
            className="h-20 w-20 shrink-0 rounded-lg border border-border object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
          {item.maker && (
            <p className="text-xs text-muted-foreground">by {item.maker}</p>
          )}
          {item.style && (
            <p className="text-xs text-muted-foreground">{item.style}</p>
          )}
          {item.aiDescription && (
            <p className="mt-1 text-xs text-foreground/80 line-clamp-2">{item.aiDescription}</p>
          )}
          {item.dominantColors && item.dominantColors.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {item.dominantColors.slice(0, 5).map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Fabric Swatch Widget ─────────────────────────────────────────────────────

function FabricSwatchWidget({ swatch }: { swatch: FabricSwatchData }) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-border/60 bg-purple-50/60 px-3 py-2 dark:bg-purple-950/30">
        <span className="text-base">🧵</span>
        <span className="text-xs font-semibold text-foreground">Fabric Swatch</span>
      </div>
      <div className="flex gap-3 p-3">
        {swatch.imageUrl && (
          <img
            src={swatch.imageUrl}
            alt={swatch.name}
            className="h-20 w-20 shrink-0 rounded-lg border border-border object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{swatch.name}</p>
          {swatch.designer && (
            <p className="text-xs text-muted-foreground">Designer: {swatch.designer}</p>
          )}
          {swatch.manufacturer && (
            <p className="text-xs text-muted-foreground">{swatch.manufacturer}</p>
          )}
          {swatch.aiDescription && (
            <p className="mt-1 text-xs text-foreground/80 line-clamp-2">{swatch.aiDescription}</p>
          )}
          {swatch.dominantColors && swatch.dominantColors.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {swatch.dominantColors.slice(0, 6).map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Destination Card Widget ──────────────────────────────────────────────────

function DestinationCardWidget({ card }: { card: DestinationCardData }) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-border/60 bg-sky-50/60 px-3 py-2 dark:bg-sky-950/30">
        <MapPin className="h-3.5 w-3.5 text-sky-600" />
        <span className="text-xs font-semibold text-foreground">Destination</span>
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{card.name}</p>
            {card.country && (
              <p className="text-xs text-muted-foreground">{card.country}</p>
            )}
          </div>
          <a
            href={card.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"
          >
            <ExternalLink className="h-3 w-3" />
            Maps
          </a>
        </div>
        {card.highlights && card.highlights.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {card.highlights.slice(0, 5).map((h, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                <span className="mt-0.5 text-sky-500">•</span>
                {h}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Main export ─────────────────────────────────────────────────────────────

export function ChatWidget({ widget }: { widget: ChatWidget }) {
  switch (widget.type) {
    case "weather":
      return (
        <WeatherWidget locationName={widget.locationName} days={widget.days} />
      );
    case "places":
      return <PlacesWidget query={widget.query} places={widget.places} />;
    case "air_quality":
      return <AirQualityWidget data={widget.data} />;
    case "pollen":
      return <PollenWidget data={widget.data} />;
    case "data_card":
      return <DataCardWidget title={widget.title} rows={widget.rows} />;
    case "image_card":
      return <ImageCardWidget title={widget.title} images={widget.images} />;
    case "exchange_rate":
      return <ExchangeRateWidget from={widget.from} to={widget.to} lastUpdated={widget.lastUpdated} />;
    case "trip_card":
      return <TripCardWidget trip={widget.trip} />;
    case "pottery_item":
      return <PotteryItemWidget item={widget.item} />;
    case "fabric_swatch":
      return <FabricSwatchWidget swatch={widget.swatch} />;
    case "destination_card":
      return <DestinationCardWidget card={widget.card} />;
  }
}
