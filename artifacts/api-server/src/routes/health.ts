import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getBootstrapStatus } from "../lib/app-config";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    configBootstrap: getBootstrapStatus(),
  });
  res.json(data);
});

export default router;
