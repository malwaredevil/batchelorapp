/**
 * Shared batch-ingest function for the Hallmark.com current catalog.
 * Called from both the GET ingest endpoint and the Apify webhook handler.
 */

import { sql } from "drizzle-orm";
import { db, hallmarkCatalog } from "@workspace/db";
import { fetchApifyDataset } from "../apify-client";
import { logger } from "../logger";

type RowValue = typeof hallmarkCatalog.$inferInsert;

export interface CatalogIngestResult {
  totalItems: number;
  inserted: number;
  skipped: number;
  errors: number;
}

/**
 * Download the Apify catalog dataset and upsert all rows into
 * hallmark_catalog in chunks of 500.
 */
export async function ingestCatalogDataset(
  datasetId: string,
  apiToken: string,
): Promise<CatalogIngestResult> {
  const items = await fetchApifyDataset(datasetId, apiToken, 10_000);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  const rows: RowValue[] = [];
  for (const item of items) {
    const sku = item["hallmarkSku"] as string | null;
    const name = item["name"] as string | null;
    if (!sku || !name) {
      skipped++;
      continue;
    }
    rows.push({
      hallmarkSku: sku,
      name,
      description: (item["description"] as string | null) ?? null,
      seriesName: (item["seriesName"] as string | null) ?? null,
      sequenceNumber: (item["sequenceNumber"] as number | null) ?? null,
      year: (item["year"] as number | null) ?? null,
      artist: (item["artist"] as string | null) ?? null,
      retailPriceUsd:
        (item["retailPriceUsd"] as number | null) != null
          ? String(item["retailPriceUsd"])
          : null,
      productUrl: (item["productUrl"] as string | null) ?? null,
      images: Array.isArray(item["images"]) ? (item["images"] as string[]) : [],
      ornamentCategory: (item["ornamentCategory"] as string | null) ?? null,
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
        .insert(hallmarkCatalog)
        .values(chunk)
        .onConflictDoUpdate({
          target: hallmarkCatalog.hallmarkSku,
          set: {
            name: sql`excluded.name`,
            description: sql`excluded.description`,
            seriesName: sql`excluded.series_name`,
            sequenceNumber: sql`excluded.sequence_number`,
            year: sql`excluded.year`,
            artist: sql`excluded.artist`,
            retailPriceUsd: sql`excluded.retail_price_usd`,
            productUrl: sql`excluded.product_url`,
            images: sql`excluded.images`,
            ornamentCategory: sql`excluded.ornament_category`,
            crawledAt: sql`excluded.crawled_at`,
            updatedAt: new Date(),
          },
        });
      inserted += chunk.length;
    } catch (err) {
      logger.warn(
        { chunkStart: i, chunkSize: chunk.length, err },
        "ornaments: catalog ingest chunk error",
      );
      errors += chunk.length;
    }
  }

  logger.info(
    { totalItems: items.length, inserted, skipped, errors },
    "ornaments: catalog ingest complete",
  );

  return { totalItems: items.length, inserted, skipped, errors };
}
