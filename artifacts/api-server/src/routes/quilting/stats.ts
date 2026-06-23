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
import { sql, isNull } from "drizzle-orm";

const router: IRouter = Router();
router.use(requireAuth);

const TOP_LIMIT = 8;

type LabelCount = { label: string; count: number };

// Count occurrences of values held in a text[] column. The array is unnested
// in Postgres and tallied case-insensitively (trimmed + lowercased) so the
// whole top-N is computed in the database instead of in Node memory.
function topArrayCounts(
  column: typeof fabrics.dominantColors | typeof fabrics.motifs,
) {
  return db
    .execute<LabelCount>(
      sql`
        select lower(trim(value)) as label, count(*)::int as count
        from ${fabrics}, unnest(${column}) as value
        where trim(value) <> ''
        group by lower(trim(value))
        order by count desc, label asc
        limit ${TOP_LIMIT}
      `,
    )
    .then((r) => r.rows);
}

router.get("/stats", async (_req, res) => {
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
          `,
      )
      .then((r) => r.rows[0]),
    topArrayCounts(fabrics.dominantColors),
    topArrayCounts(fabrics.motifs),
    db
      .execute<LabelCount>(
        sql`
            select lower(trim(${fabrics.printType})) as label, count(*)::int as count
            from ${fabrics}
            where ${fabrics.printType} is not null
              and trim(${fabrics.printType}) <> ''
            group by lower(trim(${fabrics.printType}))
            order by count desc, label asc
            limit ${TOP_LIMIT}
          `,
      )
      .then((r) => r.rows),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(quiltPatterns)
      .then((r) => r[0].count),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(finishedQuilts)
      .then((r) => r[0].count),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(blocks)
      .then((r) => r[0].count),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(layouts)
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
router.get("/stats/stale", async (_req, res) => {
  const [fabricsStale, patternsStale] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(fabrics)
      .where(isNull(fabrics.embedding))
      .then((r) => r[0].count),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(quiltPatterns)
      .where(isNull(quiltPatterns.embedding))
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
