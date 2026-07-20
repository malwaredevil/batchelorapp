/**
 * One-time (and re-runnable) migration that merges the three Hallmark catalog
 * source tables into the single hallmark_ornaments table.
 *
 * Run via: pnpm --filter @workspace/scripts run merge-hallmark-catalogs
 *
 * It is fully idempotent — subsequent runs update existing rows via
 * ON CONFLICT DO UPDATE, so it's safe to re-run after any Apify re-crawl
 * that refreshes the source tables.
 *
 * Merge priority rules (enforced in SQL):
 *   name / series_name / year:  historical > catalog > hooh
 *   artist:                     catalog > historical
 *   retail_price_usd:           catalog only  (hallmark.com current retail)
 *   collector_price_usd:        historical only (hallmarkornaments.com value)
 *   in_stock:                   hooh only     (hookedonhallmark.com status)
 *   images:                     catalog + historical, merged & deduped
 *
 * SKUs with no resolvable name in any source table are skipped.
 */

import pg from "pg";
import { resolveDatabaseUrl, sslConfig } from "@workspace/db";

const { Pool } = pg;

const MERGE_SQL = `
INSERT INTO hallmark_ornaments (
  hallmark_sku,
  name,
  description,
  series_name,
  sequence_number,
  year,
  artist,
  retail_price_usd,
  collector_price_usd,
  in_stock,
  ornament_category,
  subcategory,
  images,
  product_url_hallmark,
  product_url_historical,
  product_url_hooh,
  in_hallmark_catalog,
  in_historical_catalog,
  in_hooh_catalog
)
WITH
  -- One representative row per SKU from each source table.
  -- DISTINCT ON picks the lowest id when a SKU has multiple rows (can happen
  -- in historical/hooh since their unique key is product_url, not sku).
  cat AS (
    SELECT DISTINCT ON (hallmark_sku) *
    FROM hallmark_catalog
    WHERE hallmark_sku IS NOT NULL AND hallmark_sku != ''
    ORDER BY hallmark_sku, id
  ),
  hist AS (
    SELECT DISTINCT ON (hallmark_sku) *
    FROM hallmark_historical_catalog
    WHERE hallmark_sku IS NOT NULL AND hallmark_sku != ''
    ORDER BY hallmark_sku, id
  ),
  hooh AS (
    SELECT DISTINCT ON (hallmark_sku) *
    FROM hallmark_hooh_catalog
    WHERE hallmark_sku IS NOT NULL AND hallmark_sku != ''
    ORDER BY hallmark_sku, id
  ),
  all_skus AS (
    SELECT hallmark_sku FROM cat
    UNION
    SELECT hallmark_sku FROM hist
    UNION
    SELECT hallmark_sku FROM hooh
  )
SELECT
  s.hallmark_sku,
  -- name: historical > catalog > hooh
  COALESCE(hist.name, cat.name, hooh.name)                           AS name,
  cat.description,
  -- series_name: historical > catalog > hooh
  COALESCE(hist.series_name, cat.series_name, hooh.series_name)      AS series_name,
  COALESCE(hist.sequence_number, cat.sequence_number, hooh.sequence_number) AS sequence_number,
  -- year: historical > catalog > hooh
  COALESCE(hist.year, cat.year, hooh.year)                           AS year,
  -- artist: catalog > historical (catalog has richer artist attribution)
  COALESCE(cat.artist, hist.artist)                                  AS artist,
  cat.retail_price_usd,                   -- official Hallmark.com retail
  hist.collector_price_usd,               -- hallmarkornaments.com book value
  hooh.in_stock,                          -- hookedonhallmark.com availability
  cat.ornament_category,
  hooh.subcategory,
  -- images: merge catalog + historical arrays, deduplicate, drop NULLs
  (
    SELECT ARRAY_AGG(DISTINCT img ORDER BY img)
    FROM UNNEST(
      COALESCE(cat.images, '{}'::text[]) ||
      COALESCE(hist.images, '{}'::text[])
    ) AS img
    WHERE img IS NOT NULL
  )                                                                   AS images,
  cat.product_url                                                     AS product_url_hallmark,
  hist.product_url                                                    AS product_url_historical,
  hooh.product_url                                                    AS product_url_hooh,
  (cat.hallmark_sku  IS NOT NULL)                                     AS in_hallmark_catalog,
  (hist.hallmark_sku IS NOT NULL)                                     AS in_historical_catalog,
  (hooh.hallmark_sku IS NOT NULL)                                     AS in_hooh_catalog
FROM all_skus s
LEFT JOIN cat  ON cat.hallmark_sku  = s.hallmark_sku
LEFT JOIN hist ON hist.hallmark_sku = s.hallmark_sku
LEFT JOIN hooh ON hooh.hallmark_sku = s.hallmark_sku
-- Skip any SKU where no source table has a usable name
WHERE COALESCE(hist.name, cat.name, hooh.name) IS NOT NULL
ON CONFLICT (hallmark_sku) DO UPDATE SET
  name                  = EXCLUDED.name,
  description           = COALESCE(EXCLUDED.description,          hallmark_ornaments.description),
  series_name           = COALESCE(EXCLUDED.series_name,          hallmark_ornaments.series_name),
  sequence_number       = COALESCE(EXCLUDED.sequence_number,      hallmark_ornaments.sequence_number),
  year                  = COALESCE(EXCLUDED.year,                 hallmark_ornaments.year),
  artist                = COALESCE(EXCLUDED.artist,               hallmark_ornaments.artist),
  retail_price_usd      = COALESCE(EXCLUDED.retail_price_usd,     hallmark_ornaments.retail_price_usd),
  collector_price_usd   = COALESCE(EXCLUDED.collector_price_usd,  hallmark_ornaments.collector_price_usd),
  in_stock              = COALESCE(EXCLUDED.in_stock,             hallmark_ornaments.in_stock),
  ornament_category     = COALESCE(EXCLUDED.ornament_category,    hallmark_ornaments.ornament_category),
  subcategory           = COALESCE(EXCLUDED.subcategory,          hallmark_ornaments.subcategory),
  images                = COALESCE(EXCLUDED.images,               hallmark_ornaments.images),
  product_url_hallmark  = COALESCE(EXCLUDED.product_url_hallmark, hallmark_ornaments.product_url_hallmark),
  product_url_historical = COALESCE(EXCLUDED.product_url_historical, hallmark_ornaments.product_url_historical),
  product_url_hooh      = COALESCE(EXCLUDED.product_url_hooh,     hallmark_ornaments.product_url_hooh),
  in_hallmark_catalog   = EXCLUDED.in_hallmark_catalog,
  in_historical_catalog = EXCLUDED.in_historical_catalog,
  in_hooh_catalog       = EXCLUDED.in_hooh_catalog,
  updated_at            = now()
`;

async function main(): Promise<void> {
  console.log("[merge-hallmark-catalogs] Connecting to database...");
  const pool = new Pool({
    connectionString: resolveDatabaseUrl(),
    ssl: sslConfig,
  });

  try {
    // Quick sanity check — log source table sizes before merging
    const counts = await pool.query<{ tbl: string; n: string }>(`
      SELECT 'hallmark_catalog'            AS tbl, COUNT(*)::text AS n FROM hallmark_catalog
        WHERE hallmark_sku IS NOT NULL AND hallmark_sku != ''
      UNION ALL
      SELECT 'hallmark_historical_catalog' AS tbl, COUNT(*)::text AS n FROM hallmark_historical_catalog
        WHERE hallmark_sku IS NOT NULL AND hallmark_sku != ''
      UNION ALL
      SELECT 'hallmark_hooh_catalog'       AS tbl, COUNT(*)::text AS n FROM hallmark_hooh_catalog
        WHERE hallmark_sku IS NOT NULL AND hallmark_sku != ''
    `);
    for (const row of counts.rows) {
      console.log(
        `[merge-hallmark-catalogs]   ${row.tbl}: ${row.n} rows with a SKU`,
      );
    }

    console.log("[merge-hallmark-catalogs] Running merge...");
    const result = await pool.query(MERGE_SQL);
    const upserted = result.rowCount ?? 0;

    const [after] = (
      await pool.query<{ n: string }>(
        "SELECT COUNT(*)::text AS n FROM hallmark_ornaments",
      )
    ).rows;
    console.log(
      `[merge-hallmark-catalogs] Done — ${upserted} rows upserted, ` +
        `${after.n} total SKUs in hallmark_ornaments.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[merge-hallmark-catalogs] Failed:", err);
  process.exit(1);
});
