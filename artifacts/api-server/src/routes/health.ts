import { Router, type IRouter, type Response } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { getBootstrapStatus } from "../lib/app-config";
import { getStartupState, isStartupReady } from "../lib/startup-state";

const router: IRouter = Router();

router.get("/health/live", (_req, res) => {
  res.json({ status: "ok" });
});

async function readinessResponse(res: Response): Promise<void> {
  if (!isStartupReady()) {
    res.status(503).json({
      status: "error",
      reason: "startup_incomplete",
      startup: getStartupState(),
    });
    return;
  }
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("db_timeout")), 2000),
      ),
    ]);
  } catch {
    res.status(503).json({ status: "error", reason: "database_unavailable" });
    return;
  }
  const data = HealthCheckResponse.parse({
    status: "ok",
    configBootstrap: getBootstrapStatus(),
  });
  res.json(data);
}

router.get("/health/ready", async (_req, res) => readinessResponse(res));
router.get("/healthz", async (_req, res) => readinessResponse(res));

export default router;
