/**
 * One-shot script: pull the completed HooH Apify dataset and upsert into
 * hallmark_hooh_catalog via Supabase REST API, then cross-reference.
 *
 * Usage: pnpm --filter @workspace/scripts run ingest-hooh-now
 */
export {};

const DATASET_ID = "USp6gmfVlI9tll1mP";
const APIFY_TOKEN = process.env["APIFY_API_TOKEN"]!;
const SUPABASE_URL = process.env["SUPABASE_URL"]!;
const SUPABASE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
const CHUNK = 200;

async function fetchDataset(): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const url = `https://api.apify.com/v2/datasets/${DATASET_ID}/items?token=${APIFY_TOKEN}&offset=${offset}&limit=${limit}&clean=true`;
    const res = await fetch(url);
    if (!res.ok)
      throw new Error(`Apify fetch failed: ${res.status} ${await res.text()}`);
    const page = (await res.json()) as Record<string, unknown>[];
    if (page.length === 0) break;
    all.push(...page);
    process.stdout.write(`\r  downloaded ${all.length} items…`);
    offset += page.length;
    if (page.length < limit) break;
  }
  console.log();
  return all;
}

async function supabaseUpsert(rows: Record<string, unknown>[]): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/hallmark_hooh_catalog`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase upsert failed (${res.status}): ${body}`);
  }
}

async function supabaseRpc(
  fn: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase RPC ${fn} failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function main() {
  console.log("Fetching HooH dataset from Apify…");
  const items = await fetchDataset();
  console.log(`Downloaded ${items.length} items.`);

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const item of items) {
    const productUrl = item["productUrl"] as string | null;
    const name = item["name"] as string | null;
    if (!productUrl || !name) {
      skipped++;
      continue;
    }
    const rawPrice = item["retailPriceUsd"];
    rows.push({
      product_url: productUrl,
      catalog_id: (item["catalogId"] as number | null) ?? null,
      hallmark_sku: (item["hallmarkSku"] as string | null) ?? null,
      name,
      year: (item["year"] as number | null) ?? null,
      subcategory: (item["subcategory"] as string | null) ?? null,
      series_name: (item["seriesName"] as string | null) ?? null,
      sequence_number: (item["sequenceNumber"] as number | null) ?? null,
      retail_price_usd:
        rawPrice != null && rawPrice !== "" ? String(rawPrice) : null,
      in_stock: (item["inStock"] as boolean | null) ?? null,
      source: "hookedonhallmark.com",
      crawled_at: item["crawledAt"]
        ? new Date(item["crawledAt"] as string).toISOString()
        : new Date().toISOString(),
    });
  }

  console.log(
    `Upserting ${rows.length} rows in chunks of ${CHUNK} (${skipped} skipped)…`,
  );

  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    try {
      await supabaseUpsert(chunk);
      inserted += chunk.length;
      process.stdout.write(`\r  upserted ${inserted}/${rows.length}…`);
    } catch (err) {
      console.error(`\nChunk ${i}–${i + CHUNK} failed:`, err);
      errors += chunk.length;
    }
  }

  console.log(
    `\n✓ Done: ${inserted} upserted, ${errors} errors, ${skipped} skipped.`,
  );

  // Cross-reference price backfill via SQL function
  console.log("Running price backfill cross-reference via Supabase SQL…");
  try {
    const result = await supabaseRpc("hooh_backfill_prices");
    console.log("✓ Backfill result:", JSON.stringify(result));
  } catch (err) {
    // RPC doesn't exist yet — fall back to reporting only
    console.log(
      "  (no RPC available — skipping backfill, run manually if needed)",
    );
    console.log("  SQL to run manually:");
    console.log(`  UPDATE hallmark_historical_catalog AS hist`);
    console.log(
      `  SET collector_price_usd = hooh.retail_price_usd, updated_at = now()`,
    );
    console.log(`  FROM hallmark_hooh_catalog AS hooh`);
    console.log(`  WHERE hist.hallmark_sku = hooh.hallmark_sku`);
    console.log(`    AND hist.collector_price_usd IS NULL`);
    console.log(`    AND hooh.retail_price_usd IS NOT NULL`);
    console.log(`    AND hooh.hallmark_sku IS NOT NULL;`);
  }

  // Confirm row count
  const countRes = await fetch(
    `${SUPABASE_URL}/rest/v1/hallmark_hooh_catalog?select=count`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: "count=exact",
      },
    },
  );
  const range = countRes.headers.get("content-range") ?? "unknown";
  console.log(
    `✓ hallmark_hooh_catalog total rows: ${range.split("/")[1] ?? range}`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
