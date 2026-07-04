import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAuth } from "../../middleware/auth";
import {
  getWeatherForecast,
  getTimeZone,
  getAirQuality,
  getPollenForecast,
  fetchStaticMapImage,
  fetchStreetViewImage,
  hasStreetView,
  searchPlaces,
  getNearbyPlaceCount,
  lookupOrRequestAerialView,
  computeRoute,
  getIsochrone,
  type TravelMode,
} from "../../lib/travels/google-maps";

const router: IRouter = Router();
router.use(requireAuth);

const LatLngQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

async function handleMapsError(
  req: import("express").Request,
  res: import("express").Response,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof Error && err.message.includes("not configured")) {
      res.status(503).json({ error: "Google Maps is not configured" });
      return;
    }
    req.log.error({ err }, "Google Maps API request failed");
    res.status(502).json({ error: "Upstream Google Maps request failed" });
  }
}

router.get("/maps/weather", async (req, res) => {
  const parsed = LatLngQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }
  await handleMapsError(req, res, async () => {
    const forecast = await getWeatherForecast(parsed.data.lat, parsed.data.lng);
    res.json({ forecast });
  });
});

router.get("/maps/timezone", async (req, res) => {
  const parsed = LatLngQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }
  await handleMapsError(req, res, async () => {
    const timeZone = await getTimeZone(parsed.data.lat, parsed.data.lng);
    res.json({ timeZone });
  });
});

router.get("/maps/air-quality", async (req, res) => {
  const parsed = LatLngQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }
  await handleMapsError(req, res, async () => {
    const airQuality = await getAirQuality(parsed.data.lat, parsed.data.lng);
    res.json({ airQuality });
  });
});

router.get("/maps/pollen", async (req, res) => {
  const parsed = LatLngQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }
  await handleMapsError(req, res, async () => {
    const pollen = await getPollenForecast(parsed.data.lat, parsed.data.lng);
    res.json({ pollen });
  });
});

router.get("/maps/static-map", async (req, res) => {
  const parsed = LatLngQuery.extend({
    width: z.coerce.number().int().min(50).max(640).optional(),
    height: z.coerce.number().int().min(50).max(640).optional(),
    zoom: z.coerce.number().int().min(1).max(20).optional(),
  }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }
  await handleMapsError(req, res, async () => {
    const { buffer, contentType } = await fetchStaticMapImage(
      parsed.data.lat,
      parsed.data.lng,
      parsed.data.width,
      parsed.data.height,
      parsed.data.zoom,
    );
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  });
});

router.get("/maps/street-view", async (req, res) => {
  const parsed = LatLngQuery.extend({
    width: z.coerce.number().int().min(50).max(640).optional(),
    height: z.coerce.number().int().min(50).max(640).optional(),
  }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }
  await handleMapsError(req, res, async () => {
    const available = await hasStreetView(parsed.data.lat, parsed.data.lng);
    if (!available) {
      res
        .status(404)
        .json({ error: "No Street View coverage at this location" });
      return;
    }
    const { buffer, contentType } = await fetchStreetViewImage(
      parsed.data.lat,
      parsed.data.lng,
      parsed.data.width,
      parsed.data.height,
    );
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  });
});

router.get("/maps/places/search", async (req, res) => {
  const parsed = z
    .object({
      q: z.string().min(1).max(200),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
    })
    .safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "q is required" });
    return;
  }
  await handleMapsError(req, res, async () => {
    const places = await searchPlaces(
      parsed.data.q,
      parsed.data.lat,
      parsed.data.lng,
    );
    res.json({ places });
  });
});

router.get("/maps/nearby-count", async (req, res) => {
  const parsed = LatLngQuery.extend({
    type: z.string().min(1).max(50),
    radiusMeters: z.coerce.number().int().min(100).max(50000).optional(),
  }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "lat, lng and type are required" });
    return;
  }
  await handleMapsError(req, res, async () => {
    const count = await getNearbyPlaceCount(
      parsed.data.lat,
      parsed.data.lng,
      parsed.data.type,
      parsed.data.radiusMeters,
    );
    res.json({ count });
  });
});

router.get("/maps/aerial-view", async (req, res) => {
  const parsed = z
    .object({ address: z.string().min(1).max(300) })
    .safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "address is required" });
    return;
  }
  await handleMapsError(req, res, async () => {
    const result = await lookupOrRequestAerialView(parsed.data.address);
    res.json(result);
  });
});

const RouteWaypoint = z.object({ lat: z.number(), lng: z.number() });

const ComputeRouteBody = z.object({
  origin: RouteWaypoint,
  destination: RouteWaypoint,
  intermediates: z.array(RouteWaypoint).max(20).optional(),
  mode: z.enum(["DRIVE", "WALK", "BICYCLE", "TRANSIT"]).default("WALK"),
  optimizeWaypoints: z.boolean().default(false),
});

router.post("/maps/route", async (req, res) => {
  const parsed = ComputeRouteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid route request" });
    return;
  }
  await handleMapsError(req, res, async () => {
    const route = await computeRoute(
      parsed.data.origin,
      parsed.data.destination,
      parsed.data.intermediates ?? [],
      parsed.data.mode as TravelMode,
      parsed.data.optimizeWaypoints,
    );
    if (!route) {
      res.status(404).json({ error: "No route found" });
      return;
    }
    res.json(route);
  });
});

const IsochroneBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  travelDurationSeconds: z.number().int().min(60).max(3600),
  mode: z.enum(["DRIVE", "WALK", "BICYCLE"]).default("WALK"),
});

router.post("/maps/isochrone", async (req, res) => {
  const parsed = IsochroneBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid isochrone request" });
    return;
  }
  await handleMapsError(req, res, async () => {
    const isochrone = await getIsochrone(
      parsed.data.lat,
      parsed.data.lng,
      parsed.data.travelDurationSeconds,
      parsed.data.mode,
    );
    if (!isochrone) {
      res.status(404).json({ error: "No isochrone available" });
      return;
    }
    res.json(isochrone);
  });
});

export default router;
