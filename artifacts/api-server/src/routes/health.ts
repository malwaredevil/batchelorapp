import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getBootstrapStatus } from "../lib/app-config";
import { getStartupMigrationStatus } from "../lib/startup-migrate";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    configBootstrap: getBootstrapStatus(),
    migrations: getStartupMigrationStatus()
      ? {
          expectedLatestVersion:
            getStartupMigrationStatus()!.expectedLatestVersion,
          appliedLatestVersion: getStartupMigrationStatus()!.appliedLatestVersion,
          pendingCount: getStartupMigrationStatus()!.pending.length,
          checksumErrorCount: getStartupMigrationStatus()!.checksumErrors.length,
        }
      : null,
  });
  res.json(data);
});

export default router;
