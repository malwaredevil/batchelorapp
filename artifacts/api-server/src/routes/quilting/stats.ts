import { Router, type IRouter } from "express";
import {
  db,
  fabrics,
  quiltPatterns,
  finishedQuilts,
  blocks,
  layouts,
} from "@workspace/db";
import { GetStatsResponse, GetStaleCountResponse } from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";
import { sql, isNull, eq } from "drizzle-orm";

const router: IRouter = Router();
router.use(requireAuth);

const TOP_LIMIT = 8;

type LabelCount = { label: string; count: number };

// Count occurrences of values held in a text[] column across all items.
function topArrayCounts(
  column: typeof fabrics.dominantColors | typeof fabrics.motifs,
  userId: number,
) {
  return db
    .execute<LabelCount>(
      sql`
        select lower(trim(value)) as label, count(*)::int as count
        from ${fabrics}, unnest(${column}) as value
        where trim(value) <> '' and ${fabrics.userId} = ${userId}
        group by lower(trim(value))
        order by count desc, label asc
        limit ${TOP_LIMIT}
      `,
    )
    .then((r) => r.rows);
}

router.get("/stats", async (req, res) => {
  const userId = req.session.userId!;
  const [
    fabricTotals,
    colorRows,
    motifRows,
    printTypeRows,
    patternCount,
    quiltCount,
    blockCount,
    layoutCount,
  ] = await Promise.all([
    db
      .execute<{ total: number; yardage: number }>(
        sql`
            select
              count(*)::int as total,
              coalesce(
                sum(${fabrics.quantity}) filter (
                  where lower(${fabrics.quantityUnit}) like '%yard%'
                ),
                0
              )::double precision as yardage
            from ${fabrics}
            where ${fabrics.userId} = ${userId}
          `,
      )
      .then((r) => r.rows[0]),
    topArrayCounts(fabrics.dominantColors, userId),
    topArrayCounts(fabrics.motifs, userId),
    db
      .execute<LabelCount>(
        sql`
            select lower(trim(${fabrics.printType})) as label, count(*)::int as count
            from ${fabrics}
            where ${fabrics.printType} is not null
              and trim(${fabrics.printType}) <> ''
              and ${fabrics.userId} = ${userId}
            group by lower(trim(${fabrics.printType}))
            order by count desc, label asc
            limit ${TOP_LIMIT}
          `,
      )
      .then((r) => r.rows),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(quiltPatterns)
      .where(eq(quiltPatterns.userId, userId))
      .then((r) => r[0].count),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(finishedQuilts)
      .where(eq(finishedQuilts.userId, userId))
      .then((r) => r[0].count),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(blocks)
      .where(eq(blocks.userId, userId))
      .then((r) => r[0].count),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(layouts)
      .where(eq(layouts.userId, userId))
      .then((r) => r[0].count),
  ]);

  res.json(
    GetStatsResponse.parse({
      totalFabrics: Number(fabricTotals.total),
      totalPatterns: patternCount,
      totalQuilts: quiltCount,
      totalBlocks: blockCount,
      totalLayouts: layoutCount,
      totalYardage: Number(fabricTotals.yardage),
      topColors: colorRows.map((r) => ({
        color: r.label,
        count: Number(r.count),
      })),
      topMotifs: motifRows.map((r) => ({
        motif: r.label,
        count: Number(r.count),
      })),
      topPrintTypes: printTypeRows.map((r) => ({
        printType: r.label,
        count: Number(r.count),
      })),
    }),
  );
});

// Lightweight count of fabrics + patterns missing their AI embedding (e.g.
// after a DB restore). Powers the "needs re-analysis" badge in the app shell
// without downloading the full list payloads just to derive a single number.
router.get("/stats/stale", async (req, res) => {
  const userId = req.session.userId!;
  const [fabricsStale, patternsStale] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(fabrics)
      .where(
        sql`${fabrics.userId} = ${userId} AND ${fabrics.embedding} IS NULL`,
      )
      .then((r) => r[0].count),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(quiltPatterns)
      .where(
        sql`${quiltPatterns.userId} = ${userId} AND ${quiltPatterns.embedding} IS NULL`,
      )
      .then((r) => r[0].count),
  ]);

  res.json(
    GetStaleCountResponse.parse({
      count: fabricsStale + patternsStale,
      fabrics: fabricsStale,
      patterns: patternsStale,
    }),
  );
});

export default router;
