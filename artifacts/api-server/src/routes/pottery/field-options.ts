import { Router, type IRouter } from "express";
import { isNull } from "drizzle-orm";
import { db, potteryItems } from "@workspace/db";
import { GetPotteryFieldOptionsResponse } from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();
router.use(requireAuth);

// Household-shared, like the collection itself. Never fetch full pieces (or
// their photos/descriptions) just to populate the maker-name suggestions.
router.get("/field-options", async (_req, res) => {
  const rows = await db
    .selectDistinct({ maker: potteryItems.maker })
    .from(potteryItems)
    .where(isNull(potteryItems.deletedAt));
  const makers = [
    ...new Set(
      rows
        .map((row) => row.maker?.trim())
        .filter((maker): maker is string => Boolean(maker)),
    ),
  ].sort((a, b) => a.localeCompare(b));
  res.json(GetPotteryFieldOptionsResponse.parse({ makers }));
});

export default router;
