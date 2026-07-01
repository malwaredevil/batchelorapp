import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, travelsTrips } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { callModel, MODELS } from "../../lib/ai-client";

const router: IRouter = Router();
router.use(requireAuth);

function parseAiJson(raw: string): unknown {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(stripped);
}

const GenerateItineraryBody = z.object({
  style: z.enum(["relaxed", "balanced", "packed"]),
  interests: z.array(z.string()),
  regenerateDay: z.number().int().optional(),
});

const ExploreBody = z.object({
  destination: z.string().min(1),
});

const SuggestBody = z.object({ destination: z.string().min(1) });

const HOME_LAT = 48.7178;
const HOME_LNG = 9.4853;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function transportSummary(trip: {
  transportTo: string | null;
  hasRentalCar: boolean;
}): string {
  const parts: string[] = [];
  if (trip.transportTo === "flew") parts.push("arrived by flight");
  else if (trip.transportTo === "train") parts.push("arrived by train");
  else if (trip.transportTo === "drove") parts.push("drove there (own car available)");
  if (trip.hasRentalCar) parts.push("has a rental car");
  else if (trip.transportTo !== "drove") parts.push("no car — relies on walking/transit/taxi");
  return parts.join(", ") || "transport mode unknown";
}

function proximityGuide(trip: {
  transportTo: string | null;
  hasRentalCar: boolean;
}): string {
  const hasCar = trip.transportTo === "drove" || trip.hasRentalCar;
  if (hasCar) {
    return `The traveller has a car. Include a full range of proximity tags:
🚶 Walking (< 1 km from accommodation)
🚌 Public transit (1–10 km)
🚗 Short drive / taxi (10–30 km)
🏞️ Day trip (30+ km, driving recommended)`;
  }
  return `The traveller has NO car. Strongly prefer walking and transit activities. Avoid car-dependent suggestions as primary options. For day trips, use public transit routes.
🚶 Walking (< 1 km from accommodation) — prioritise these
🚌 Public transit (1–10 km) — include these freely
🚗 Taxi/ride-share (10–20 km) — use sparingly for must-see attractions
🚫 Avoid: suggestions that require a car or driving`;
}

router.post("/trips/:id/itinerary", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [trip] = await db
    .select()
    .from(travelsTrips)
    .where(and(eq(travelsTrips.id, id), eq(travelsTrips.userId, userId)));

  if (!trip) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const body = GenerateItineraryBody.parse(req.body);
  const { style, interests, regenerateDay } = body;

  const dateRange =
    trip.startDate && trip.endDate
      ? `${trip.startDate} to ${trip.endDate}`
      : "dates not specified";

  const area = [trip.accommodationArea, trip.accommodationName]
    .filter(Boolean)
    .join(" — ") || trip.destination;

  const styleDesc = {
    relaxed: "relaxed pace (1–2 major activities per day, leisurely)",
    balanced: "balanced pace (3–4 activities per day, mix of active and rest)",
    packed: "packed schedule (5–6 activities per day, maximise sightseeing)",
  }[style];

  const interestStr =
    interests.length > 0 ? interests.join(", ") : "general tourism";

  const existingItinerary = trip.itinerary as {
    days?: Array<{ date: string; title: string; activities: unknown[] }>;
  } | null;

  let prompt: string;

  if (regenerateDay !== undefined && existingItinerary?.days) {
    const day = existingItinerary.days[regenerateDay];
    if (!day) {
      res.status(400).json({ error: "Day index out of range" });
      return;
    }
    prompt = `Regenerate ONLY day ${regenerateDay + 1} (${day.date}) of a trip itinerary for ${trip.destination}.

Staying near: ${area}
Transport: ${transportSummary(trip)}
Travel style: ${styleDesc}
Interests: ${interestStr}
Travellers: ${trip.travellerCount}

${proximityGuide(trip)}

Return ONLY a JSON object for ONE day:
{
  "date": "${day.date}",
  "title": "theme for the day",
  "activities": [
    {
      "time": "09:00",
      "name": "Activity name",
      "description": "2-3 sentence description with practical info",
      "proximity": "🚶 Walking",
      "tip": "One practical insider tip"
    }
  ]
}

Return ONLY valid JSON, no extra text.`;
  } else {
    prompt = `Create a day-by-day travel itinerary for a trip to ${trip.destination}.

Date range: ${dateRange}
Staying near: ${area}
Transport: ${transportSummary(trip)}
Travel style: ${styleDesc}
Interests: ${interestStr}
Travellers: ${trip.travellerCount}

${proximityGuide(trip)}

Return a JSON object:
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "title": "theme for the day",
      "activities": [
        {
          "time": "09:00",
          "name": "Activity name",
          "description": "2-3 sentence description with practical info",
          "proximity": "🚶 Walking",
          "tip": "One practical insider tip"
        }
      ]
    }
  ]
}

If dates are unspecified, create 5 days labelled Day 1, Day 2, etc. Return ONLY valid JSON, no extra text.`;
  }

  const raw = await callModel(MODELS.SMART_VISION, async (client, model) => {
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4000,
    });
    return resp.choices[0]?.message?.content ?? "{}";
  });

  let parsed: unknown;
  try {
    parsed = parseAiJson(raw);
  } catch {
    res.status(500).json({ error: "AI returned invalid JSON" });
    return;
  }

  let newItinerary: unknown;
  if (regenerateDay !== undefined && existingItinerary?.days) {
    const days = [...existingItinerary.days];
    days[regenerateDay] = parsed as (typeof days)[number];
    newItinerary = { days };
  } else {
    newItinerary = parsed;
  }

  await db
    .update(travelsTrips)
    .set({ itinerary: newItinerary as Record<string, unknown> })
    .where(and(eq(travelsTrips.id, id), eq(travelsTrips.userId, userId)));

  res.json({ itinerary: newItinerary });
});

router.post("/explore", async (req, res) => {
  const body = ExploreBody.parse(req.body);
  const { destination } = body;

  let lat = 0;
  let lng = 0;
  try {
    const geoResp = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=json&limit=1`,
      { headers: { "User-Agent": "Batchelor-App/1.0 (app.batchelor.app)" } },
    );
    const geoData = (await geoResp.json()) as Array<{
      lat: string;
      lon: string;
    }>;
    if (geoData.length > 0) {
      lat = parseFloat(geoData[0].lat);
      lng = parseFloat(geoData[0].lon);
    }
  } catch (err) {
    req.log.warn({ err }, "Nominatim geocoding failed");
  }

  const overviewRaw = await callModel(
    MODELS.SMART_VISION,
    async (client, model) => {
      const resp = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "user",
            content: `Give me a travel overview for: ${destination}

Return a JSON object:
{
  "description": "2-3 sentence engaging description of the destination",
  "highlights": [
    {
      "name": "Attraction/experience name",
      "description": "One sentence description",
      "category": "culture | food | nature | adventure | history | shopping"
    }
  ],
  "bestTimeToVisit": "When to go and why",
  "practicalInfo": {
    "currency": "local currency",
    "language": "primary language",
    "timezone": "timezone name",
    "tipping": "brief tipping custom note",
    "transit": "brief note on getting around"
  }
}

Include 6-8 highlights. Return ONLY valid JSON, no extra text.`,
          },
        ],
        max_tokens: 2000,
      });
      return resp.choices[0]?.message?.content ?? "{}";
    },
  );

  let overview: unknown;
  try {
    overview = parseAiJson(overviewRaw);
  } catch {
    overview = { description: overviewRaw };
  }

  const distanceKm =
    lat && lng ? Math.round(haversineKm(HOME_LAT, HOME_LNG, lat, lng)) : null;
  const mapsUrl = `https://www.google.com/maps/dir/Reichenbach+an+der+Fils,+Germany/${encodeURIComponent(destination)}`;

  res.json({ destination, lat, lng, overview, distanceKm, mapsUrl });
});

router.post("/highlights/suggest", async (req, res) => {
  const { destination } = SuggestBody.parse(req.body);
  const raw = await callModel(MODELS.FAST_VISION, async (client, model) => {
    const resp = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: `List 10 top must-do experiences, attractions, and highlights for a trip to ${destination}.
Return ONLY a JSON array of short, specific names (2-5 words each). No descriptions or explanations.
Example: ["Old Town Square", "Sunset Tram Ride", "Castle Tour", "Local Food Market", "River Cruise"]`,
        },
      ],
      max_tokens: 300,
    });
    return resp.choices[0]?.message?.content ?? "[]";
  });
  let suggestions: string[];
  try {
    suggestions = parseAiJson(raw) as string[];
    if (!Array.isArray(suggestions)) suggestions = [];
  } catch {
    suggestions = [];
  }
  res.json({ suggestions: suggestions.map(String).slice(0, 10) });
});

router.get("/stats", async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db
    .select({
      status: travelsTrips.status,
      destination: travelsTrips.destination,
      startDate: travelsTrips.startDate,
      endDate: travelsTrips.endDate,
    })
    .from(travelsTrips)
    .where(eq(travelsTrips.userId, userId));

  const totalTrips = rows.length;
  const completedTrips = rows.filter((r) => r.status === "completed").length;
  const upcomingTrips = rows.filter(
    (r) => r.status === "booked" || r.status === "active",
  ).length;
  const uniqueDestinations = new Set(
    rows.map((r) => r.destination.toLowerCase()),
  ).size;

  const today = new Date().toISOString().slice(0, 10);
  const nextTrip = rows
    .filter(
      (r) =>
        r.status === "booked" && r.startDate != null && r.startDate >= today,
    )
    .sort((a, b) => (a.startDate! > b.startDate! ? 1 : -1))[0] ?? null;

  res.json({
    totalTrips,
    completedTrips,
    upcomingTrips,
    uniqueDestinations,
    nextTrip,
  });
});

// ── Per-trip AI chat ─────────────────────────────────────────────────────────

type ChatMessage = { role: "user" | "assistant"; content: string };

const ChatBody = z.object({ message: z.string().min(1).max(2000) });

router.post("/trips/:id/chat", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [trip] = await db
    .select()
    .from(travelsTrips)
    .where(and(eq(travelsTrips.id, id), eq(travelsTrips.userId, userId)));
  if (!trip) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { message } = ChatBody.parse(req.body);
  const history = (trip.chatHistory as ChatMessage[] | null) ?? [];

  const startDate = trip.startDate ?? "TBD";
  const endDate = trip.endDate ?? "TBD";
  const durationMs =
    trip.startDate && trip.endDate
      ? new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()
      : null;
  const duration =
    durationMs != null
      ? `${Math.ceil(durationMs / (1000 * 60 * 60 * 24))} nights`
      : "unknown duration";

  const systemPrompt = `You are a friendly, knowledgeable travel assistant for a trip to ${trip.destination}.

Trip: "${trip.title}"
Dates: ${startDate} → ${endDate} (${duration})
Travellers: ${trip.travellerCount} people
Transport: ${transportSummary(trip)}${trip.accommodationName ? `\nStaying at: ${trip.accommodationName}${trip.accommodationArea ? ` (${trip.accommodationArea})` : ""}` : ""}${trip.notes ? `\nNotes: ${trip.notes}` : ""}
${trip.itinerary ? "An itinerary has already been planned for this trip." : "No itinerary planned yet."}

Answer questions about ${trip.destination}: things to do, local food, customs, transport, packing, day trips, weather, safety tips, and anything else useful. Be concise, practical, and friendly.`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: message },
  ];

  const aiContent = await callModel(MODELS.FAST_VISION, async (client, model) => {
    const response = await client.chat.completions.create({
      model,
      messages,
      max_tokens: 600,
    });
    return response.choices[0]?.message?.content ?? "";
  });

  const updatedHistory: ChatMessage[] = [
    ...history,
    { role: "user", content: message },
    { role: "assistant", content: aiContent },
  ];

  await db
    .update(travelsTrips)
    .set({ chatHistory: updatedHistory })
    .where(and(eq(travelsTrips.id, id), eq(travelsTrips.userId, userId)));

  res.json({ role: "assistant", content: aiContent, history: updatedHistory });
});

router.delete("/trips/:id/chat", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [existing] = await db
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(and(eq(travelsTrips.id, id), eq(travelsTrips.userId, userId)));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await db
    .update(travelsTrips)
    .set({ chatHistory: [] })
    .where(and(eq(travelsTrips.id, id), eq(travelsTrips.userId, userId)));

  res.json({ history: [] });
});

export default router;
