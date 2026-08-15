/**
 * GET /api/admin/sentry/issues?environment=production|development
 *
 * Owner-only. Lists current unresolved Sentry issues for the requested
 * environment via the Sentry REST API. Returns `{ configured: false }` with
 * an empty list when the Sentry API credentials are not set, so the owner
 * panel can render a friendly "not configured" state instead of an error.
 */

import { Router, type IRouter } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireOwner } from "../../middleware/owner";
import { adminLimiter } from "../../middleware/rateLimit";
import { listSentryIssues } from "../../lib/sentry-issues";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(adminLimiter, requireAuth, requireOwner);

router.get("/", async (req, res) => {
  const raw = String(req.query["environment"] ?? "production");
  if (raw !== "production" && raw !== "development") {
    res.status(400).json({
      error: 'environment must be "production" or "development"',
    });
    return;
  }

  try {
    const result = await listSentryIssues({ environment: raw });
    res.json({
      configured: result.configured,
      environment: raw,
      issues: result.issues,
    });
  } catch (err) {
    logger.warn({ err }, "admin/sentry-issues: Sentry API call failed");
    res.status(502).json({ error: "Sentry API request failed" });
  }
});

export default router;
