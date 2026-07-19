/**
 * Shared batch-ingest function for the HookedOnHallmark collector catalog.
 * Called from both the manual GET ingest endpoint and the Apify webhook handler.
 *
 * After upserting into hallmark_hooh_catalog, runs a cross-reference UPDATE to
 * backfill collector_price_usd on hallmark_historical_catalog for any row where
 * the Hallmark SKU matches and the price was previously NULL.
 */

import { sql } from "drizzle-orm";
import { db, hallmarkHoohCatalog } from "@workspace/db";
import { fetchApifyDataset } from "../apify-client";
import { logger } from "../logger";

type RowValue = typeof hallmarkHoohCatalog.$inferInsert;

export interface IngestHoohResult {
  totalItems: number;
  inserted: number;
  skipped: number;
  errors: number;
  pricesBackfilled: number;
}

/**
 * Download the Apify dataset and upsert all rows into hallmark_hooh_catalog
 * in chunks of 500. After the upsert, cross-reference with
 * hallmark_historical_catalog to backfill missing collector prices by SKU.
 */
export async function ingestHoohDataset(
  datasetId: string,
  apiToken: string,
): Promise<IngestHoohResult> {
  const items = await fetchApifyDataset(datasetId, apiToken, 25_000);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  const rows: RowValue[] = [];
  for (const item of items) {
    const productUrl = item["productUrl"] as string | null;
    const name = item["name"] as string | null;
    if (!productUrl || !name) {
      skipped++;
      continue;
    }
    const rawPrice = item["retailPriceUsd"];
    rows.push({
      productUrl,
      catalogId: (item["catalogId"] as number | null) ?? null,
      hallmarkSku: (item["hallmarkSku"] as string | null) ?? null,
      name,
      year: (item["year"] as number | null) ?? null,
      subcategory: (item["subcategory"] as string | null) ?? null,
      seriesName: (item["seriesName"] as string | null) ?? null,
      sequenceNumber: (item["sequenceNumber"] as number | null) ?? null,
      retailPriceUsd:
        rawPrice != null && rawPrice !== "" ? String(rawPrice) : null,
      inStock: (item["inStock"] as boolean | null) ?? null,
      source: "hookedonhallmark.com",
      crawledAt: item["crawledAt"]
        ? new Date(item["crawledAt"] as string)
        : new Date(),
    });
  }

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    try {
      await db
        .insert(hallmarkHoohCatalog)
        .values(chunk)
        .onConflictDoUpdate({
          target: hallmarkHoohCatalog.productUrl,
          set: {
            catalogId: sql`excluded.catalog_id`,
            hallmarkSku: sql`excluded.hallmark_sku`,
            name: sql`excluded.name`,
            year: sql`excluded.year`,
            subcategory: sql`excluded.subcategory`,
            seriesName: sql`excluded.series_name`,
            sequenceNumber: sql`excluded.sequence_number`,
            retailPriceUsd: sql`excluded.retail_price_usd`,
            inStock: sql`excluded.in_stock`,
            crawledAt: sql`excluded.crawled_at`,
            updatedAt: new Date(),
          },
        });
      inserted += chunk.length;
    } catch (err) {
      logger.warn(
        { chunkStart: i, chunkSize: chunk.length, err },
        "ornaments: hooh ingest chunk error",
      );
      errors += chunk.length;
    }
  }

  // Cross-reference: backfill collector_price_usd on hallmark_historical_catalog
  // wherever a matching SKU exists and price is currently NULL.
  let pricesBackfilled = 0;
  try {
    const result = await db.execute(sql`
      UPDATE hallmark_historical_catalog AS hist
      SET
        collector_price_usd = hooh.retail_price_usd,
        updated_at          = now()
      FROM hallmark_hooh_catalog AS hooh
      WHERE hist.hallmark_sku    = hooh.hallmark_sku
        AND hist.collector_price_usd IS NULL
        AND hooh.retail_price_usd   IS NOT NULL
        AND hooh.hallmark_sku       IS NOT NULL
    `);
    pricesBackfilled = (result.rowCount as number | null) ?? 0;
  } catch (err) {
    logger.warn(
      { err },
      "ornaments: hooh price backfill cross-reference failed",
    );
  }

  logger.info(
    { totalItems: items.length, inserted, skipped, errors, pricesBackfilled },
    "ornaments: hooh ingest complete",
  );

  return {
    totalItems: items.length,
    inserted,
    skipped,
    errors,
    pricesBackfilled,
  };
}
