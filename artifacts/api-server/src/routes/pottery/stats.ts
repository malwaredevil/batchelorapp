import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, potteryItems } from "@workspace/db";
import { GetCollectionStatsResponse } from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();
router.use(requireAuth);

function topCounts(
  counts: Map<string, number>,
): { label: string; count: number }[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, count]) => ({ label, count }));
}

router.get("/stats", async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db
    .select({
      motifs: potteryItems.motifs,
      colors: potteryItems.dominantColors,
    })
    .from(potteryItems)
    .where(eq(potteryItems.userId, userId));

  const motifCounts = new Map<string, number>();
  const colorCounts = new Map<string, number>();

  for (const row of rows) {
    for (const motif of row.motifs ?? []) {
      const key = motif.trim().toLowerCase();
      if (key) motifCounts.set(key, (motifCounts.get(key) ?? 0) + 1);
    }
    for (const color of row.colors ?? []) {
      const key = color.trim().toLowerCase();
      if (key) colorCounts.set(key, (colorCounts.get(key) ?? 0) + 1);
    }
  }

  res.json(
    GetCollectionStatsResponse.parse({
      totalItems: rows.length,
      topMotifs: topCounts(motifCounts),
      topColors: topCounts(colorCounts),
    }),
  );
});

export default router;
