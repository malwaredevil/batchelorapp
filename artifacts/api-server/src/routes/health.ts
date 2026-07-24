import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { getBootstrapStatus } from "../lib/app-config";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
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
});

export default router;
