/**
 * Shared batch-ingest function for the Hallmark historical catalog.
 * Called from both the GET ingest endpoint and the Apify webhook handler.
 */

import { sql } from "drizzle-orm";
import { db, hallmarkHistoricalCatalog } from "@workspace/db";
import { fetchApifyDataset } from "../apify-client";
import { logger } from "../logger";

type RowValue = typeof hallmarkHistoricalCatalog.$inferInsert;

export interface IngestResult {
  totalItems: number;
  inserted: number;
  skipped: number;
  errors: number;
}

/**
 * Download the Apify dataset and upsert all rows into
 * hallmark_historical_catalog in chunks of 500.
 */
export async function ingestHistoricalDataset(
  datasetId: string,
  apiToken: string,
): Promise<IngestResult> {
  const items = await fetchApifyDataset(datasetId, apiToken, 50_000);

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
    rows.push({
      hallmarkSku: (item["hallmarkSku"] as string | null) ?? null,
      name,
      year: (item["year"] as number | null) ?? null,
      seriesName: (item["seriesName"] as string | null) ?? null,
      sequenceNumber: (item["sequenceNumber"] as number | null) ?? null,
      artist: (item["artist"] as string | null) ?? null,
      collectorPriceUsd:
        (item["collectorPriceUsd"] as number | null) != null
          ? String(item["collectorPriceUsd"])
          : null,
      productUrl,
      images: Array.isArray(item["images"]) ? (item["images"] as string[]) : [],
      source: "hallmarkornaments.com",
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
        .insert(hallmarkHistoricalCatalog)
        .values(chunk)
        .onConflictDoUpdate({
          target: hallmarkHistoricalCatalog.productUrl,
          set: {
            hallmarkSku: sql`excluded.hallmark_sku`,
            name: sql`excluded.name`,
            year: sql`excluded.year`,
            seriesName: sql`excluded.series_name`,
            sequenceNumber: sql`excluded.sequence_number`,
            artist: sql`excluded.artist`,
            collectorPriceUsd: sql`excluded.collector_price_usd`,
            images: sql`excluded.images`,
            crawledAt: sql`excluded.crawled_at`,
            updatedAt: new Date(),
          },
        });
      inserted += chunk.length;
    } catch (err) {
      logger.warn(
        { chunkStart: i, chunkSize: chunk.length, err },
        "ornaments: historical ingest chunk error",
      );
      errors += chunk.length;
    }
  }

  logger.info(
    { totalItems: items.length, inserted, skipped, errors },
    "ornaments: historical ingest complete",
  );

  return { totalItems: items.length, inserted, skipped, errors };
}
