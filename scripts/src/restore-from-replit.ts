/**
 * restore-from-replit.ts
 *
 * Restores all pottery + quilting + travels data from the Replit built-in
 * PostgreSQL backup database back into Supabase. Use this only when Supabase
 * data has been accidentally wiped or corrupted by a bad migration.
 *
 * USAGE:
 *   pnpm --filter @workspace/scripts run restore-from-replit -- --confirm
 *
 * The --confirm flag is a required deliberate safety gate.
 *
 * AFTER RESTORING:
 *   - AI embeddings are NOT restored (require pgvector; regenerate via each
 *     app's Settings > Maintenance > Bulk Re-analyse).
 *   - Image files are stored in Supabase Storage (not in the DB) and are
 *     unaffected by database disasters.
 *   - Mirrors backup-to-replit.ts's table/column set exactly, including
 *     app_users phone/SMS fields and the agentphone_* tables — keep both
 *     scripts in sync when adding new tables or columns.
 *   - password_hash and OAuth tokens are NOT restored — after a restore users
 *     must reset their passwords and reconnect Google Calendar / Gmail.
 *
 * Source:      Replit DB — PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE
 * Destination: Supabase  — DATABASE_URL (rewritten to pooler by resolveDatabaseUrl)
 */

import pg from "pg";
import { resolveDatabaseUrl, sslConfig } from "@workspace/db";

const { Client } = pg;

async function copyTable(
  source: pg.Client,
  dest: pg.Client,
  opts: {
    table: string;
    columns: string[];
    orderBy?: string;
    jsonbColumns?: string[];
  },
): Promise<number> {
  const cols = opts.columns.join(", ");
  const order = opts.orderBy ? ` ORDER BY ${opts.orderBy}` : "";
  const { rows } = await source.query(
    `SELECT ${cols} FROM ${opts.table}${order}`,
  );
  const jsonbCols = new Set(opts.jsonbColumns ?? []);
  const placeholders = opts.columns
    .map((c, i) => (jsonbCols.has(c) ? `$${i + 1}::jsonb` : `$${i + 1}`))
    .join(", ");
  for (const row of rows) {
    const values = opts.columns.map((c) => {
      const v = row[c] ?? null;
      if (jsonbCols.has(c) && v !== null && typeof v !== "string") {
        return JSON.stringify(v);
      }
      return v;
    });
    await dest.query(
      `INSERT INTO ${opts.table} (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      values,
    );
  }
  return rows.length;
}

async function resetSequence(dest: pg.Client, table: string, col: string) {
  await dest.query(`
    SELECT setval(
      pg_get_serial_sequence('${table}', '${col}'),
      COALESCE((SELECT MAX(${col}) FROM ${table}), 0) + 1,
      false
    )
  `);
}

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error(
      "ERROR: --confirm flag required.\n\n" +
        "This script overwrites live Supabase data with the Replit DB backup.\n" +
        "Verify the backup is good first, then run:\n\n" +
        "  pnpm --filter @workspace/scripts run restore-from-replit -- --confirm\n",
    );
    process.exit(1);
  }

  const source = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl: false,
  });
  const dest = new Client({
    connectionString: resolveDatabaseUrl(),
    ssl: sslConfig,
  });

  console.log("Connecting to Replit DB (source) and Supabase (destination)...");
  await source.connect();
  await dest.connect();

  const { rows: histRows } = await source.query(
    "SELECT ran_at, note FROM backup_history ORDER BY ran_at DESC LIMIT 1",
  );
  if (histRows.length > 0) {
    console.log(`Last backup: ${histRows[0].ran_at}`);
    console.log(`Contents:   ${histRows[0].note}`);
  } else {
    console.error("No backup history found in Replit DB. Aborting.");
    process.exit(1);
  }

  console.log("\nRestoring to Supabase (TRUNCATE + INSERT per table)...");

  // Wrap the entire restore in a single transaction: any mid-run failure
  // automatically rolls back all TRUNCATEs and leaves Supabase unchanged.
  // PostgreSQL rolls back open transactions automatically when the connection
  // closes, so a script crash also cleans up without leaving a partial state.
  await dest.query("BEGIN");

  // Disable triggers so FK order doesn't matter
  await dest.query("SET session_replication_role = replica");

  // ── Shared ────────────────────────────────────────────────────────────────
  await dest.query("TRUNCATE app_users CASCADE");
  await copyTable(source, dest, {
    table: "app_users",
    columns: [
      "id",
      "email",
      // password_hash excluded — credential, not stored in backup DB (#326)
      "display_name",
      "theme_preference",
      "hub_widget_ids",
      "hub_weather_config",
      "travels_reminder_email",
      "timezone",
      "is_owner",
      "phone_number",
      "phone_verified",
      "phone_verified_at",
      "sms_consent_at",
      "sms_opted_out_at",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "app_users", "id");

  await dest.query(
    "TRUNCATE agentphone_conversations, agentphone_webhook_deliveries CASCADE",
  );
  await copyTable(source, dest, {
    table: "agentphone_conversations",
    columns: ["id", "phone_number", "user_id", "messages", "updated_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "agentphone_conversations", "id");

  await copyTable(source, dest, {
    table: "agentphone_webhook_deliveries",
    columns: ["id", "received_at"],
    orderBy: "received_at",
  });

  await dest.query("TRUNCATE app_gmail_connections CASCADE");
  await copyTable(source, dest, {
    table: "app_gmail_connections",
    columns: [
      "id",
      "user_id",
      "google_email",
      // refresh_token, access_token, access_token_expires_at excluded — OAuth tokens (#326)
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "app_gmail_connections", "id");

  // ── Pottery ───────────────────────────────────────────────────────────────
  await dest.query("TRUNCATE pottery_item_categories CASCADE");
  await dest.query("TRUNCATE pottery_images CASCADE");
  await dest.query("TRUNCATE pottery_items CASCADE");
  await dest.query("TRUNCATE pottery_categories CASCADE");

  await copyTable(source, dest, {
    table: "pottery_categories",
    columns: ["id", "name", "bg_color", "text_color", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "pottery_categories", "id");

  await copyTable(source, dest, {
    table: "pottery_items",
    columns: [
      "id",
      "name",
      "quantity",
      "notes",
      "dimensions",
      "pattern_description",
      "style",
      "shape",
      "maker",
      "maker_info",
      "dominant_colors",
      "motifs",
      "image_path",
      "pattern_crop_path",
      "acquired_at",
      "condition",
      "origin",
      "approximate_era",
      "ai_description",
      "locked_fields",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "pottery_items", "id");

  await copyTable(source, dest, {
    table: "pottery_images",
    columns: [
      "id",
      "item_id",
      "storage_path",
      "label",
      "position",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "pottery_images", "id");

  await copyTable(source, dest, {
    table: "pottery_item_categories",
    columns: ["item_id", "category_id"],
  });

  await copyTable(source, dest, {
    table: "pottery_watchlist_items",
    columns: [
      "id",
      "created_by_user_id",
      "title",
      "keywords",
      "price_min_usd",
      "price_max_usd",
      "active",
      "last_checked_at",
      "last_alert_at",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "pottery_watchlist_items", "id");

  await copyTable(source, dest, {
    table: "pottery_watchlist_alerts",
    columns: [
      "id",
      "watchlist_item_id",
      "platform",
      "listing_id",
      "title",
      "price_usd",
      "condition",
      "image_url",
      "listing_url",
      "sold_at",
      "seen_at",
      "dismissed",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "pottery_watchlist_alerts", "id");

  // ── Ornaments ─────────────────────────────────────────────────────────────
  await dest.query("TRUNCATE ornaments_item_categories CASCADE");
  await dest.query("TRUNCATE ornaments_images CASCADE");
  await dest.query("TRUNCATE ornament_item_series_links CASCADE");
  await dest.query("TRUNCATE ornament_identity_research CASCADE");
  await dest.query("TRUNCATE ornament_series_entries CASCADE");
  await dest.query("TRUNCATE ornament_series CASCADE");
  await dest.query("TRUNCATE ornaments_items CASCADE");
  await dest.query("TRUNCATE ornaments_categories CASCADE");
  await dest.query("TRUNCATE ornaments_barcode_cache CASCADE");
  await dest.query("TRUNCATE hallmark_ornaments CASCADE");
  await dest.query("TRUNCATE ornaments_hallmark_events CASCADE");

  await copyTable(source, dest, {
    table: "ornaments_categories",
    columns: ["id", "name", "bg_color", "text_color", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "ornaments_categories", "id");

  await copyTable(source, dest, {
    table: "ornaments_items",
    columns: [
      "id",
      "name",
      "brand",
      "series_or_collection",
      "year",
      "barcode_value",
      "quantity",
      "notes",
      "dimensions",
      "condition",
      "origin",
      "acquired_at",
      "ai_description",
      "dominant_colors",
      "motifs",
      "image_path",
      "locked_fields",
      "book_value",
      "book_value_source",
      "book_value_updated_at",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ornaments_items", "id");

  await copyTable(source, dest, {
    table: "ornaments_images",
    columns: [
      "id",
      "item_id",
      "storage_path",
      "label",
      "position",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ornaments_images", "id");

  await copyTable(source, dest, {
    table: "ornaments_item_categories",
    columns: ["item_id", "category_id"],
  });

  await copyTable(source, dest, {
    table: "ornaments_barcode_cache",
    columns: [
      "barcode",
      "found",
      "name",
      "brand",
      "series_or_collection",
      "year",
      "description",
      "image_url",
      "created_at",
      "hallmark_sku",
      "hallmark_series_name",
      "hallmark_sequence_number",
      "hallmark_artist",
      "hallmark_original_retail_price",
      "hallmark_product_url",
      "hallmark_confidence",
      "hallmark_enriched_at",
      "hallmark_collector_price_usd",
      "hallmark_in_stock",
      "hallmark_images",
    ],
    orderBy: "barcode",
  });

  await copyTable(source, dest, {
    table: "hallmark_ornaments",
    columns: [
      "id",
      "hallmark_sku",
      "name",
      "description",
      "series_name",
      "sequence_number",
      "year",
      "artist",
      "retail_price_usd",
      "collector_price_usd",
      "in_stock",
      "ornament_category",
      "subcategory",
      "images",
      "product_url_hallmark",
      "product_url_historical",
      "product_url_hooh",
      "in_hallmark_catalog",
      "in_historical_catalog",
      "in_hooh_catalog",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "hallmark_ornaments", "id");

  await copyTable(source, dest, {
    table: "ornaments_hallmark_events",
    columns: [
      "id",
      "user_id",
      "title",
      "description",
      "start_date",
      "end_date",
      "google_event_id",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ornaments_hallmark_events", "id");

  await copyTable(source, dest, {
    table: "ornament_series",
    columns: [
      "id",
      "name",
      "brand",
      "description",
      "start_year",
      "end_year",
      "is_active",
      "total_known_entries",
      "source_url",
      "source_authority",
      "is_provisional",
      "last_confirmed_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ornament_series", "id");

  await copyTable(source, dest, {
    table: "ornament_series_entries",
    columns: [
      "id",
      "series_id",
      "sequence_number",
      "year",
      "official_name",
      "catalog_number",
      "upc",
      "artist",
      "retail_price_usd",
      "release_type",
      "is_exclusive",
      "notes",
      "source_url",
      "is_provisional",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ornament_series_entries", "id");

  await copyTable(source, dest, {
    table: "ornament_item_series_links",
    columns: [
      "item_id",
      "series_entry_id",
      "confirmed_by_user_id",
      "confirmed_at",
      "confidence",
      "created_at",
    ],
    orderBy: "item_id",
  });

  await copyTable(source, dest, {
    table: "ornament_identity_research",
    columns: [
      "id",
      "item_id",
      "status",
      "candidates",
      "selected_candidate_index",
      "decided_by_user_id",
      "decided_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
    jsonbColumns: ["candidates"],
  });
  await resetSequence(dest, "ornament_identity_research", "id");

  // ── Office ────────────────────────────────────────────────────────────────
  await dest.query("TRUNCATE office_notes CASCADE");

  await copyTable(source, dest, {
    table: "office_notes",
    columns: [
      "id",
      "title",
      "body",
      "created_by_user_id",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "office_notes", "id");

  // ── Quilting ──────────────────────────────────────────────────────────────
  await dest.query(
    "TRUNCATE quilting_entity_categories, quilting_fabric_links, quilting_pattern_links, quilting_images, quilting_blocks, quilting_block_templates, quilting_layouts, quilting_shopping_items, quilting_fabric_identifiers, quilting_pattern_requirements, quilting_pattern_variants, quilting_analyses, quilting_fabric_identity_research CASCADE",
  );
  await dest.query("TRUNCATE quilting_finished_quilts CASCADE");
  await dest.query("TRUNCATE quilting_fabrics CASCADE");
  await dest.query("TRUNCATE quilting_patterns CASCADE");
  await dest.query("TRUNCATE quilting_categories CASCADE");

  await copyTable(source, dest, {
    table: "quilting_categories",
    columns: ["id", "name", "bg_color", "text_color", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_categories", "id");

  await copyTable(source, dest, {
    table: "quilting_fabrics",
    columns: [
      "id",
      "name",
      "line_name",
      "designer",
      "manufacturer",
      "colorway",
      "print_type",
      "fiber_content",
      "width_inches",
      "quantity",
      "quantity_unit",
      "sku",
      "notes",
      "ai_description",
      "dominant_colors",
      "motifs",
      "style_descriptors",
      "image_path",
      "acquired_at",
      "locked_fields",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_fabrics", "id");

  await copyTable(source, dest, {
    table: "quilting_patterns",
    columns: [
      "id",
      "name",
      "designer",
      "block_size",
      "difficulty",
      "source_type",
      "source_reference",
      "notes",
      "image_path",
      "acquired_at",
      "locked_fields",
      "designer_bio",
      "designer_website",
      "publication_name",
      "publication_year",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_patterns", "id");

  await copyTable(source, dest, {
    table: "quilting_finished_quilts",
    columns: [
      "id",
      "name",
      "date_completed",
      "size_width",
      "size_height",
      "recipient",
      "notes",
      "image_path",
      "locked_fields",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_finished_quilts", "id");

  await copyTable(source, dest, {
    table: "quilting_fabric_links",
    columns: ["quilt_id", "fabric_id", "notes"],
  });
  await copyTable(source, dest, {
    table: "quilting_pattern_links",
    columns: ["quilt_id", "pattern_id"],
  });
  await copyTable(source, dest, {
    table: "quilting_entity_categories",
    columns: ["entity_type", "entity_id", "category_id"],
  });

  await copyTable(source, dest, {
    table: "quilting_images",
    columns: [
      "id",
      "entity_type",
      "entity_id",
      "storage_path",
      "label",
      "position",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_images", "id");

  await copyTable(source, dest, {
    table: "quilting_blocks",
    columns: [
      "id",
      "name",
      "grid_size",
      "cells",
      "block_size_inches",
      "seam_allowance_inches",
      "seams",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_blocks", "id");

  await copyTable(source, dest, {
    table: "quilting_block_templates",
    columns: [
      "id",
      "created_by_user_id",
      "name",
      "tags",
      "grid_w",
      "grid_h",
      "cells",
      "seams",
      "block_size_inches",
      "seam_allowance_inches",
      "thumbnail_svg",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_block_templates", "id");

  await copyTable(source, dest, {
    table: "quilting_layouts",
    columns: [
      "id",
      "name",
      "rows",
      "cols",
      "cells",
      "sashing_width_inches",
      "sashing_color",
      "border_width_inches",
      "border_color",
      "cornerstone_color",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_layouts", "id");

  await copyTable(source, dest, {
    table: "quilting_shopping_items",
    columns: [
      "id",
      "name",
      "notes",
      "url",
      "quantity",
      "unit",
      "estimated_price_usd",
      "actual_price_usd",
      "store",
      "status",
      "priority",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_shopping_items", "id");

  await copyTable(source, dest, {
    table: "quilting_fabric_identifiers",
    columns: [
      "id",
      "fabric_id",
      "identifier_type",
      "identifier_value",
      "source_url",
      "confirmed_by_user_id",
      "confirmed_at",
      "confidence",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_fabric_identifiers", "id");

  await copyTable(source, dest, {
    table: "quilting_pattern_variants",
    columns: [
      "id",
      "pattern_id",
      "name",
      "finished_width",
      "finished_height",
      "size_unit",
      "block_count",
      "skill_level",
      "notes",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_pattern_variants", "id");

  await copyTable(source, dest, {
    table: "quilting_pattern_requirements",
    columns: [
      "id",
      "variant_id",
      "role",
      "color_description",
      "quantity_yards",
      "quantity_fat_quarters",
      "width_assumption_inches",
      "seam_allowance_inches",
      "notes",
      "is_extracted",
      "extraction_confidence",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_pattern_requirements", "id");

  await copyTable(source, dest, {
    table: "quilting_analyses",
    columns: [
      "id",
      "pattern_id",
      "variant_id",
      "created_by_user_id",
      "status",
      "readiness",
      "stash_snapshot_at",
      "assumptions",
      "requirement_rows",
      "shopping_proposal",
      "applied_at",
      "applied_by_user_id",
      "created_at",
    ],
    orderBy: "id",
    jsonbColumns: ["assumptions", "requirement_rows", "shopping_proposal"],
  });
  await resetSequence(dest, "quilting_analyses", "id");

  await copyTable(source, dest, {
    table: "quilting_fabric_identity_research",
    columns: [
      "id",
      "fabric_id",
      "status",
      "candidates",
      "selected_candidate_index",
      "decided_by_user_id",
      "decided_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
    jsonbColumns: ["candidates"],
  });
  await resetSequence(dest, "quilting_fabric_identity_research", "id");

  // ── Travels ───────────────────────────────────────────────────────────────
  await dest.query(
    "TRUNCATE messenger_reactions, messenger_link_previews, messenger_attachments, messenger_messages, messenger_conversations, travels_calendar_trip_suggestions, travels_custom_document_types, travels_trip_card_collapse_state, travels_card_layout_preferences, travels_gmail_scan_decisions, travels_gmail_connections, elaine_history_messages, elaine_history_conversations, elaine_global_config, elaine_nudges, elaine_memory, elaine_settings, elaine_email_webhook_deliveries, elaine_email_conversations, elaine_conversations, travels_reminder_calendar_events, travels_connected_calendars, travels_google_calendar_connections, travels_calendar_settings, travels_reminder_alert_log, travels_reminders, travels_wishlist, travels_trip_photos, travels_trip_documents CASCADE",
  );
  await dest.query("TRUNCATE travels_trips CASCADE");

  await copyTable(source, dest, {
    table: "travels_trips",
    columns: [
      "id",
      "user_id",
      "title",
      "destination",
      "lat",
      "lng",
      "status",
      "start_date",
      "end_date",
      "transport_to",
      "transport_details",
      "has_rental_car",
      "accommodation_name",
      "accommodation_area",
      "notes",
      "fun_fact",
      "traveller_count",
      "travelers",
      "the_one_thing",
      "itinerary",
      "packing_list",
      "chat_history",
      "todo_list",
      "icon_photo_id",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_trips", "id");

  await copyTable(source, dest, {
    table: "travels_trip_documents",
    columns: [
      "id",
      "trip_id",
      "user_id",
      "storage_path",
      "title",
      "document_type",
      "original_filename",
      "extracted_data",
      "locked_fields",
      "gmail_message_id",
      "icon_override",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_trip_documents", "id");

  await copyTable(source, dest, {
    table: "travels_trip_photos",
    columns: [
      "id",
      "trip_id",
      "user_id",
      "storage_path",
      "caption",
      "photo_type",
      "sort_order",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_trip_photos", "id");

  await copyTable(source, dest, {
    table: "travels_wishlist",
    columns: [
      "id",
      "user_id",
      "destination",
      "target_date",
      "notes",
      "lat",
      "lng",
      "done",
      "sort_order",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_wishlist", "id");

  await copyTable(source, dest, {
    table: "travels_reminders",
    columns: [
      "id",
      "trip_id",
      "user_id",
      "title",
      "due_date",
      "done",
      "recipient_emails",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_reminders", "id");

  await copyTable(source, dest, {
    table: "travels_reminder_alert_log",
    columns: ["id", "reminder_id", "user_id", "alert_type", "sent_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_reminder_alert_log", "id");

  await copyTable(source, dest, {
    table: "travels_calendar_settings",
    columns: ["id", "calendar_id", "calendar_summary", "updated_at"],
    orderBy: "id",
  });

  await copyTable(source, dest, {
    table: "travels_google_calendar_connections",
    columns: [
      "id",
      "user_id",
      "google_email",
      // refresh_token, access_token, access_token_expires_at excluded — OAuth tokens (#326)
      "calendar_id",
      "calendar_summary",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_google_calendar_connections", "id");

  await copyTable(source, dest, {
    table: "travels_connected_calendars",
    columns: [
      "id",
      "user_id",
      "google_calendar_id",
      "summary",
      "source",
      "primary_color",
      "is_travel_calendar",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_connected_calendars", "id");

  await copyTable(source, dest, {
    table: "travels_reminder_calendar_events",
    columns: ["id", "reminder_id", "user_id", "google_event_id", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_reminder_calendar_events", "id");

  await copyTable(source, dest, {
    table: "elaine_conversations",
    columns: ["id", "user_id", "messages", "updated_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "elaine_conversations", "id");

  await copyTable(source, dest, {
    table: "elaine_email_conversations",
    columns: ["id", "user_id", "messages", "last_message_id", "updated_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "elaine_email_conversations", "id");

  await copyTable(source, dest, {
    table: "elaine_email_webhook_deliveries",
    columns: ["id", "received_at"],
    orderBy: "received_at",
  });

  await copyTable(source, dest, {
    table: "elaine_settings",
    columns: [
      "user_id",
      "enabled",
      "action_confirmation_mode",
      "chat_window_size",
      "updated_at",
    ],
    orderBy: "user_id",
  });

  await copyTable(source, dest, {
    table: "elaine_memory",
    columns: ["id", "content", "created_by_user_id", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "elaine_memory", "id");

  await copyTable(source, dest, {
    table: "elaine_nudges",
    columns: [
      "id",
      "user_id",
      "source_app",
      "source_id",
      "nudge_key",
      "message",
      "created_at",
      "seen_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "elaine_nudges", "id");

  await copyTable(source, dest, {
    table: "elaine_global_config",
    columns: [
      "id",
      "chat_model",
      "subagent_model",
      "request_timeout_ms",
      "max_response_tokens",
      "extra_models",
      "timeouts",
      "features",
      "thresholds",
      "updated_at",
      "updated_by_user_id",
    ],
    orderBy: "id",
  });

  await copyTable(source, dest, {
    table: "elaine_history_conversations",
    columns: ["id", "user_id", "title", "created_at", "updated_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "elaine_history_conversations", "id");

  await copyTable(source, dest, {
    table: "elaine_history_messages",
    columns: [
      "id",
      "conversation_id",
      "user_id",
      "role",
      "content",
      "attachment_urls",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "elaine_history_messages", "id");

  await copyTable(source, dest, {
    table: "travels_gmail_connections",
    columns: [
      "id",
      "user_id",
      "google_email",
      // refresh_token, access_token, access_token_expires_at excluded — OAuth tokens (#326)
      "last_history_id",
      "last_scan_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_gmail_connections", "id");

  await copyTable(source, dest, {
    table: "travels_gmail_scan_decisions",
    columns: [
      "id",
      "user_id",
      "gmail_message_id",
      "thread_id",
      "subject",
      "from_address",
      "received_at",
      "status",
      "extracted_data",
      "dedupe_key",
      "suggested_trip_id",
      "trip_id",
      "trip_document_id",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_gmail_scan_decisions", "id");

  await copyTable(source, dest, {
    table: "travels_card_layout_preferences",
    columns: ["user_id", "card_order", "updated_at"],
    orderBy: "user_id",
  });

  await copyTable(source, dest, {
    table: "travels_trip_card_collapse_state",
    columns: ["id", "user_id", "trip_id", "collapsed_cards", "updated_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_trip_card_collapse_state", "id");

  await copyTable(source, dest, {
    table: "travels_custom_document_types",
    columns: [
      "id",
      "user_id",
      "type_key",
      "type_name",
      "description",
      "icon_name",
      "color_key",
      "fields",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_custom_document_types", "id");

  await copyTable(source, dest, {
    table: "travels_calendar_trip_suggestions",
    columns: [
      "id",
      "suggested_title",
      "destination",
      "start_date",
      "end_date",
      "related_event_ids",
      "dedupe_key",
      "status",
      "user_id",
      "is_from_shared_calendar",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_calendar_trip_suggestions", "id");

  // ── Messenger ─────────────────────────────────────────────────────────────
  await copyTable(source, dest, {
    table: "messenger_conversations",
    columns: ["id", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "messenger_conversations", "id");

  await copyTable(source, dest, {
    table: "messenger_messages",
    columns: [
      "id",
      "conversation_id",
      "sender_id",
      "body",
      "read_at",
      "deleted_at",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "messenger_messages", "id");

  await copyTable(source, dest, {
    table: "messenger_attachments",
    columns: [
      "id",
      "message_id",
      "storage_path",
      "mime_type",
      "file_name",
      "size_bytes",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "messenger_attachments", "id");

  await copyTable(source, dest, {
    table: "messenger_link_previews",
    columns: ["id", "url", "title", "description", "image_url", "fetched_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "messenger_link_previews", "id");

  await copyTable(source, dest, {
    table: "messenger_reactions",
    columns: ["id", "message_id", "user_id", "emoji", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "messenger_reactions", "id");

  // ── Phase 2: Operations ───────────────────────────────────────────────────
  await copyTable(source, dest, {
    table: "app_schema_migrations",
    columns: [
      "version",
      "name",
      "checksum_sha256",
      "applied_at",
      "applied_by",
      "execution_ms",
      "app_commit_sha",
    ],
    orderBy: "version",
  });

  await copyTable(source, dest, {
    table: "app_jobs",
    columns: [
      "id",
      "type",
      "queue",
      "status",
      "priority",
      "payload",
      "payload_schema_version",
      "idempotency_key",
      "created_by_user_id",
      "domain",
      "scheduled_for",
      "attempt_count",
      "max_attempts",
      "lease_owner",
      "lease_expires_at",
      "started_at",
      "completed_at",
      "progress_percent",
      "progress_message",
      "last_error_code",
      "last_error_message",
      "provider_request_id",
      "parent_job_id",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "app_jobs", "id");

  await copyTable(source, dest, {
    table: "app_job_attempts",
    columns: [
      "id",
      "job_id",
      "attempt_number",
      "status",
      "started_at",
      "completed_at",
      "error_code",
      "error_message",
      "metadata",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "app_job_attempts", "id");

  await copyTable(source, dest, {
    table: "external_operation_events",
    columns: [
      "id",
      "provider",
      "operation",
      "model_or_actor",
      "feature",
      "module",
      "user_id",
      "request_id",
      "job_id",
      "parent_job_id",
      "status",
      "error_code",
      "started_at",
      "completed_at",
      "duration_ms",
      "attempt_number",
      "retry_count",
      "cache_status",
      "input_units",
      "output_units",
      "billed_units",
      "estimated_cost_usd",
      "actual_cost_usd",
      "currency",
      "pricing_version_at",
      "provider_request_id",
      "metadata",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "external_operation_events", "id");

  await copyTable(source, dest, {
    table: "external_provider_pricing",
    columns: [
      "id",
      "provider",
      "operation",
      "model_or_actor",
      "unit_type",
      "price_usd",
      "effective_from",
      "effective_to",
      "source",
      "notes",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "external_provider_pricing", "id");

  await copyTable(source, dest, {
    table: "external_budget_policies",
    columns: [
      "id",
      "scope",
      "scope_value",
      "period",
      "soft_threshold_usd",
      "hard_threshold_usd",
      "warning_policy",
      "degradation_action",
      "enabled",
      "override_until",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "external_budget_policies", "id");

  // ── Phase 2: AI provenance ────────────────────────────────────────────────
  await copyTable(source, dest, {
    table: "ai_generation_runs",
    columns: [
      "id",
      "module",
      "feature",
      "target_type",
      "target_id",
      "job_id",
      "operation_event_id",
      "user_id",
      "provider",
      "model",
      "model_provider_run_id",
      "prompt_template_id",
      "prompt_version_hash",
      "tool_schema_version",
      "input_artifact_hashes",
      "status",
      "error_code",
      "error_message",
      "started_at",
      "completed_at",
      "duration_ms",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ai_generation_runs", "id");

  await copyTable(source, dest, {
    table: "ai_field_candidates",
    columns: [
      "id",
      "generation_run_id",
      "target_type",
      "target_id",
      "field_path",
      "candidate_value",
      "normalized_value_hash",
      "confidence_score",
      "confidence_method",
      "authority_class",
      "source_references",
      "disposition",
      "applied_at",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ai_field_candidates", "id");

  await copyTable(source, dest, {
    table: "ai_field_decisions",
    columns: [
      "id",
      "candidate_id",
      "deciding_user_id",
      "decision_type",
      "prior_value",
      "final_value",
      "correction_category",
      "context_source",
      "decided_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ai_field_decisions", "id");

  await copyTable(source, dest, {
    table: "ai_prompt_versions",
    columns: [
      "id",
      "template_id",
      "version",
      "hash",
      "schema_version",
      "effective_from",
      "effective_until",
      "release_notes",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ai_prompt_versions", "id");

  // ── Phase 2: Ingestion ────────────────────────────────────────────────────
  await copyTable(source, dest, {
    table: "ingestion_sources",
    columns: [
      "id",
      "name",
      "slug",
      "adapter_type",
      "adapter_config",
      "config_schema_version",
      "module",
      "feature",
      "enabled",
      "owner_notes",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ingestion_sources", "id");

  await copyTable(source, dest, {
    table: "ingestion_runs",
    columns: [
      "id",
      "source_id",
      "job_id",
      "triggered_by",
      "trigger_type",
      "status",
      "items_fetched",
      "items_matched",
      "items_merged",
      "items_rejected",
      "error_code",
      "error_message",
      "started_at",
      "completed_at",
      "metadata",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ingestion_runs", "id");

  await copyTable(source, dest, {
    table: "ingestion_candidates",
    columns: [
      "id",
      "run_id",
      "source_id",
      "source_key",
      "target_type",
      "target_id",
      "normalized_data",
      "confidence_score",
      "status",
      "matched_at",
      "merged_at",
      "rejected_reason",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ingestion_candidates", "id");

  // ── Phase 2: Search feedback ──────────────────────────────────────────────
  await copyTable(source, dest, {
    table: "search_feedback",
    columns: [
      "id",
      "user_id",
      "module",
      "item_a_type",
      "item_a_id",
      "item_b_type",
      "item_b_id",
      "verdict",
      "weight",
      "notes",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "search_feedback", "id");

  // ── Phase 2: Document evidence ────────────────────────────────────────────
  await copyTable(source, dest, {
    table: "travels_document_pages",
    columns: [
      "id",
      "trip_document_id",
      "page_index",
      "media_type",
      "width_px",
      "height_px",
      "extracted_text",
      "ocr_engine",
      "ocr_engine_version",
      "extraction_status",
      "extraction_warnings",
      "content_hash",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_document_pages", "id");

  await copyTable(source, dest, {
    table: "travels_document_field_evidence",
    columns: [
      "id",
      "candidate_id",
      "document_page_id",
      "evidence_kind",
      "text_start",
      "text_end",
      "bbox",
      "snippet",
      "ocr_confidence",
      "evidence_hash",
      "source_timestamp",
      "effective_timestamp",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_document_field_evidence", "id");

  await copyTable(source, dest, {
    table: "travels_field_conflicts",
    columns: [
      "id",
      "trip_id",
      "field_path",
      "accepted_candidate_id",
      "accepted_value",
      "competing_candidate_ids",
      "conflict_type",
      "recommended_candidate_id",
      "recommended_rationale",
      "status",
      "deciding_user_id",
      "decided_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_field_conflicts", "id");

  // ── Phase 2: Similarity evaluations (#233) ────────────────────────────────
  await copyTable(source, dest, {
    table: "similarity_evaluations",
    columns: [
      "id",
      "module",
      "workflow",
      "query_artifact_type",
      "query_artifact_id",
      "candidate_target_type",
      "candidate_target_id",
      "search_config_version",
      "text_embedding_model",
      "text_cosine_score",
      "text_rank",
      "visual_embedding_model",
      "visual_cosine_score",
      "visual_rank",
      "zone_cosine_score",
      "zone_rank",
      "rrf_score",
      "reranker_model",
      "reranker_score",
      "reranker_rank",
      "user_verdict",
      "user_id",
      "recorded_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "similarity_evaluations", "id");

  // ── Phase 3: Market intelligence (#234) ──────────────────────────────────
  await copyTable(source, dest, {
    table: "market_observations",
    columns: [
      "id",
      "module",
      "item_type",
      "item_id",
      "ingestion_candidate_id",
      "platform",
      "listing_url",
      "listing_title",
      "observed_price",
      "currency",
      "condition",
      "listing_status",
      "listed_at",
      "sold_at",
      "source_json",
      "confidence_score",
      "notes",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "market_observations", "id");

  await copyTable(source, dest, {
    table: "market_valuations",
    columns: [
      "id",
      "module",
      "item_type",
      "item_id",
      "valuation_method",
      "estimated_value",
      "value_low",
      "value_high",
      "currency",
      "sample_size",
      "observation_ids",
      "valid_until",
      "notes",
      "created_by",
      "computed_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "market_valuations", "id");

  await copyTable(source, dest, {
    table: "market_watches",
    columns: [
      "id",
      "user_id",
      "module",
      "item_type",
      "item_id",
      "search_query",
      "platforms",
      "enabled",
      "alert_threshold_low",
      "alert_threshold_high",
      "alert_currency",
      "last_run_at",
      "notes",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "market_watches", "id");

  // ── Notifications ─────────────────────────────────────────────────────────
  await copyTable(source, dest, {
    table: "notification_events",
    columns: [
      "id",
      "event_type",
      "module",
      "severity",
      "scope",
      "subject_type",
      "subject_id",
      "title",
      "summary",
      "action_url",
      "action_label",
      "payload",
      "dedup_key",
      "last_seen_at",
      "expires_at",
      "superseded_by",
      "occurred_at",
      "created_by",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "notification_events", "id");

  await copyTable(source, dest, {
    table: "notification_recipients",
    columns: [
      "id",
      "event_id",
      "user_id",
      "read_at",
      "acknowledged_at",
      "dismissed_at",
      "snoozed_until",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "notification_recipients", "id");

  await copyTable(source, dest, {
    table: "notification_deliveries",
    columns: [
      "id",
      "recipient_id",
      "event_id",
      "channel",
      "status",
      "attempt_count",
      "scheduled_at",
      "sent_at",
      "delivered_at",
      "failed_at",
      "failure_class",
      "provider_message_id",
      "idempotency_key",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "notification_deliveries", "id");

  await copyTable(source, dest, {
    table: "notification_preferences",
    columns: [
      "id",
      "user_id",
      "scope",
      "scope_value",
      "channel_in_app",
      "channel_email",
      "channel_sms",
      "channel_push",
      "quiet_hours_enabled",
      "quiet_hours_timezone",
      "quiet_hours_start",
      "quiet_hours_end",
      "critical_override",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "notification_preferences", "id");

  // ── Knowledge graph (#239) ─────────────────────────────────────────────────
  await copyTable(source, dest, {
    table: "knowledge_entities",
    columns: [
      "id",
      "entity_type",
      "display_name",
      "normalized_name",
      "summary",
      "lifecycle_state",
      "confidence",
      "canonical",
      "merged_into_id",
      "created_by_user_id",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "knowledge_entities", "id");

  await copyTable(source, dest, {
    table: "knowledge_entity_aliases",
    columns: [
      "id",
      "entity_id",
      "alias_text",
      "normalized_alias",
      "alias_type",
      "locale",
      "source",
      "confirmed",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "knowledge_entity_aliases", "id");

  await copyTable(source, dest, {
    table: "knowledge_external_identifiers",
    columns: [
      "id",
      "entity_id",
      "namespace",
      "identifier",
      "normalized_identifier",
      "scope",
      "provenance",
      "confirmed",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "knowledge_external_identifiers", "id");

  await copyTable(source, dest, {
    table: "knowledge_domain_links",
    columns: [
      "id",
      "entity_id",
      "domain_type",
      "record_id",
      "relationship_role",
      "provenance",
      "confidence",
      "state",
      "decided_by_user_id",
      "decided_at",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "knowledge_domain_links", "id");

  await copyTable(source, dest, {
    table: "knowledge_relationships",
    columns: [
      "id",
      "subject_entity_id",
      "predicate",
      "object_entity_id",
      "effective_from",
      "effective_until",
      "attributes",
      "provenance",
      "confidence",
      "state",
      "created_at",
      "updated_at",
    ],
    jsonbColumns: ["attributes"],
    orderBy: "id",
  });
  await resetSequence(dest, "knowledge_relationships", "id");

  await dest.query("SET session_replication_role = DEFAULT");
  await dest.query("COMMIT");

  console.log("\n✓ Restore complete.");
  console.log(
    "  Remember to run Bulk Re-analyse in each app to rebuild AI embeddings.",
  );

  await source.end();
  await dest.end();
}

main().catch((err) => {
  console.error("Restore failed:", err);
  process.exit(1);
});
