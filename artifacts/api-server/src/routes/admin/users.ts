import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, appUsers, pool } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { requireOwner } from "../../middleware/owner";
import { adminLimiter } from "../../middleware/rateLimit";
import { getAuthenticatedUserId } from "../../lib/auth-context";
import { isValidIanaTimeZone } from "../../lib/timezone";

const router = Router();
router.use(adminLimiter, requireAuth, requireOwner);

// Columns returned to callers — passwordHash is never included.
const USER_SELECT = {
  id: appUsers.id,
  email: appUsers.email,
  displayName: appUsers.displayName,
  themePreference: appUsers.themePreference,
  timezone: appUsers.timezone,
  travelsReminderEmail: appUsers.travelsReminderEmail,
  birthday: appUsers.birthday,
  isOwner: appUsers.isOwner,
  phoneNumber: appUsers.phoneNumber,
  phoneVerified: appUsers.phoneVerified,
  phoneVerifiedAt: appUsers.phoneVerifiedAt,
  smsConsentAt: appUsers.smsConsentAt,
  smsOptedOutAt: appUsers.smsOptedOutAt,
  smsFirstOutboundSentAt: appUsers.smsFirstOutboundSentAt,
  slackUserId: appUsers.slackUserId,
  createdAt: appUsers.createdAt,
} as const;

// ---------------------------------------------------------------------------
// GET / — all household members (no passwordHash)
// ---------------------------------------------------------------------------
router.get("/", async (_req, res) => {
  const users = await db
    .select(USER_SELECT)
    .from(appUsers)
    .orderBy(appUsers.createdAt);
  res.json({ users });
});

// ---------------------------------------------------------------------------
// PATCH /:id — update any editable field
//
// Editable fields: displayName, email, themePreference, timezone,
// travelsReminderEmail, birthday, slackUserId, isOwner, phoneNumber,
// phoneVerified, plus two boolean shortcuts smsConsentNow / smsOptedOut.
//
// Note: hubWidgetIds, hubAppCardOrder, hubWeatherConfig are intentionally
// excluded — they are raw JSON per-user UI state, not meaningful as form
// inputs in an admin panel.
// ---------------------------------------------------------------------------
const PatchUserSchema = z.object({
  displayName: z.string().trim().min(1).max(200).nullable().optional(),
  email: z.string().email().max(254).optional(),
  themePreference: z.enum(["light", "dark"]).nullable().optional(),
  timezone: z
    .string()
    .max(100)
    .nullable()
    .optional()
    .refine((tz) => tz == null || isValidIanaTimeZone(tz), {
      message: "Must be a valid IANA timezone (e.g. America/Denver)",
    }),
  travelsReminderEmail: z.string().email().max(254).nullable().optional(),
  birthday: z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Must be MM-DD")
    .nullable()
    .optional(),
  slackUserId: z.string().max(50).nullable().optional(),
  isOwner: z.boolean().optional(),
  phoneNumber: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, "Must be E.164 format")
    .nullable()
    .optional(),
  phoneVerified: z.boolean().optional(),
  // God-mode shortcuts: true = set timestamp to now, false = clear to null
  smsConsentNow: z.boolean().optional(),
  smsOptedOut: z.boolean().optional(),
});

router.patch("/:id", async (req, res) => {
  const targetId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(targetId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const parsed = PatchUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { smsConsentNow, smsOptedOut, isOwner, ...directFields } = parsed.data;

  // Guard: owner cannot remove their own isOwner flag
  if (isOwner === false) {
    let requesterId: number;
    try {
      requesterId = getAuthenticatedUserId(req);
    } catch {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (requesterId === targetId) {
      res
        .status(400)
        .json({ error: "You cannot remove your own owner status." });
      return;
    }
  }

  const updatePayload: Record<string, unknown> = { ...directFields };
  if (isOwner !== undefined) updatePayload["isOwner"] = isOwner;
  if (smsConsentNow === true) updatePayload["smsConsentAt"] = new Date();
  else if (smsConsentNow === false) updatePayload["smsConsentAt"] = null;
  if (smsOptedOut === true) updatePayload["smsOptedOutAt"] = new Date();
  else if (smsOptedOut === false) updatePayload["smsOptedOutAt"] = null;
  // Keep phoneVerifiedAt in sync with the phoneVerified god-mode toggle.
  // (The phone-number-change block below overrides this when a new number is
  // supplied — clearing both fields regardless — which is the correct policy.)
  if (parsed.data.phoneVerified === true)
    updatePayload["phoneVerifiedAt"] = new Date();
  else if (parsed.data.phoneVerified === false)
    updatePayload["phoneVerifiedAt"] = null;

  // Security: changing phoneNumber invalidates all number-bound verification and
  // consent state. If the request supplies a new number but does NOT explicitly
  // set the verification/consent fields, auto-clear them so that an arbitrary
  // replacement number cannot inherit verified/consented status from the old one.
  // An owner performing a deliberate god-mode override can include the fields
  // explicitly in the same PATCH body to bypass the auto-clear.
  if (parsed.data.phoneNumber !== undefined) {
    const [current] = await db
      .select({ phoneNumber: appUsers.phoneNumber })
      .from(appUsers)
      .where(eq(appUsers.id, targetId))
      .limit(1);
    if (current && parsed.data.phoneNumber !== current.phoneNumber) {
      // phoneVerifiedAt and smsFirstOutboundSentAt are not user-settable — always clear
      updatePayload["phoneVerifiedAt"] = null;
      updatePayload["smsFirstOutboundSentAt"] = null;
      // Clear these only when the caller has not provided an explicit override
      if (!("phoneVerified" in parsed.data))
        updatePayload["phoneVerified"] = false;
      if (smsConsentNow === undefined) updatePayload["smsConsentAt"] = null;
      if (smsOptedOut === undefined) updatePayload["smsOptedOutAt"] = null;
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(appUsers)
    .set(updatePayload)
    .where(eq(appUsers.id, targetId))
    .returning(USER_SELECT);

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ user: updated });
});

// ---------------------------------------------------------------------------
// DELETE /:id — delete a user and all their owned data in a transaction.
//
// Deletion policy:
//  • User-owned content (pottery, quilting, ornaments, travels, elaine…) is
//    hard-deleted to avoid orphaned rows.
//  • Actor/author references on shared audit/history tables are NULLed to
//    preserve the record while removing the PII link.
//  • Many FK constraints on content tables use NO ACTION (the default), so
//    owned rows must be removed before the app_users row is deleted.
//    Tables that already have ON DELETE CASCADE / SET NULL in the live schema
//    are handled automatically by the parent-row delete at the end.
// ---------------------------------------------------------------------------
router.delete("/:id", async (req, res) => {
  const targetId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(targetId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  let requesterId: number;
  try {
    requesterId = getAuthenticatedUserId(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (requesterId === targetId) {
    res.status(400).json({ error: "You cannot delete your own account." });
    return;
  }

  // Verify the target user exists before starting the transaction
  const [target] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.id, targetId))
    .limit(1);

  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const p = [targetId];

    // ── 1. Null out attribution references on shared/audit tables ────────────
    // These rows belong to the whole household; we preserve them but remove
    // the user ID link so no PII remains.
    await client.query(
      "UPDATE household_activity_log SET actor_user_id = NULL WHERE actor_user_id = $1",
      p,
    );
    await client.query(
      "UPDATE elaine_global_config SET updated_by_user_id = NULL WHERE updated_by_user_id = $1",
      p,
    );
    await client.query(
      "UPDATE office_notes SET created_by_user_id = NULL WHERE created_by_user_id = $1",
      p,
    );
    // Quilting shared attribution
    await client.query(
      "UPDATE quilting_block_templates SET created_by_user_id = NULL WHERE created_by_user_id = $1",
      p,
    );
    await client.query(
      "UPDATE quilting_fabric_identifiers SET confirmed_by_user_id = NULL WHERE confirmed_by_user_id = $1",
      p,
    );
    await client.query(
      "UPDATE quilting_analyses SET created_by_user_id = NULL WHERE created_by_user_id = $1",
      p,
    );
    await client.query(
      "UPDATE quilting_analyses SET applied_by_user_id = NULL WHERE applied_by_user_id = $1",
      p,
    );
    await client.query(
      "UPDATE quilting_fabric_identity_research SET decided_by_user_id = NULL WHERE decided_by_user_id = $1",
      p,
    );
    // Pottery shared attribution
    await client.query(
      "UPDATE pottery_watchlist_items SET created_by_user_id = NULL WHERE created_by_user_id = $1",
      p,
    );
    // Travels shared attribution (trips, reservations, and monitoring are
    // household-scoped; null the actor/author rather than deleting the row)
    await client.query(
      "UPDATE travels_calendar_trip_suggestions SET user_id = NULL WHERE user_id = $1",
      p,
    );
    await client.query(
      "UPDATE travels_packing_items SET added_by_user_id = NULL WHERE added_by_user_id = $1",
      p,
    );
    await client.query(
      "UPDATE travels_diary_entries SET added_by_user_id = NULL WHERE added_by_user_id = $1",
      p,
    );
    await client.query(
      "UPDATE travels_field_conflicts SET deciding_user_id = NULL WHERE deciding_user_id = $1",
      p,
    );
    await client.query(
      "UPDATE travels_reservations SET created_by_user_id = NULL WHERE created_by_user_id = $1",
      p,
    );
    await client.query(
      "UPDATE travel_monitoring_baselines SET confirmed_by_user_id = NULL WHERE confirmed_by_user_id = $1",
      p,
    );
    await client.query(
      "UPDATE travel_change_events SET decided_by_user_id = NULL WHERE decided_by_user_id = $1",
      p,
    );

    // ── 2. Delete Elaine data (leaf tables first) ────────────────────────────
    // Scheduled actions initiated by this user (initiated_by_user_id FK, no CASCADE)
    await client.query(
      "DELETE FROM elaine_scheduled_actions WHERE initiated_by_user_id = $1",
      p,
    );
    await client.query("DELETE FROM elaine_daily_briefs WHERE user_id = $1", p);
    await client.query("DELETE FROM elaine_turn_traces WHERE user_id = $1", p);
    await client.query(
      "DELETE FROM elaine_history_messages WHERE user_id = $1",
      p,
    );
    await client.query(
      "DELETE FROM elaine_history_conversations WHERE user_id = $1",
      p,
    );
    await client.query("DELETE FROM elaine_nudges WHERE user_id = $1", p);
    await client.query(
      "DELETE FROM elaine_memory_events WHERE user_id = $1",
      p,
    );
    await client.query(
      "DELETE FROM elaine_memory WHERE owner_user_id = $1 OR created_by_user_id = $1",
      p,
    );
    await client.query("DELETE FROM elaine_settings WHERE user_id = $1", p);
    await client.query(
      "DELETE FROM elaine_conversations WHERE user_id = $1",
      p,
    );
    await client.query(
      "DELETE FROM elaine_email_conversations WHERE user_id = $1",
      p,
    );
    // agentphone/SMS conversation history
    await client.query(
      "DELETE FROM agentphone_conversations WHERE user_id = $1",
      p,
    );

    // ── 3. Delete Travels data ───────────────────────────────────────────────
    // OAuth tokens and mailbox connections first (security-critical)
    await client.query(
      "DELETE FROM travels_google_calendar_connections WHERE user_id = $1",
      p,
    );
    await client.query(
      "DELETE FROM travels_gmail_connections WHERE user_id = $1",
      p,
    );
    await client.query(
      "DELETE FROM app_gmail_connections WHERE user_id = $1",
      p,
    );
    // Personal preferences / UI state
    await client.query(
      "DELETE FROM travels_card_layout_preferences WHERE user_id = $1",
      p,
    );
    await client.query(
      "DELETE FROM travels_trip_card_collapse_state WHERE user_id = $1",
      p,
    );
    await client.query(
      "DELETE FROM travels_custom_document_types WHERE user_id = $1",
      p,
    );
    await client.query(
      "DELETE FROM travels_packing_templates WHERE user_id = $1",
      p,
    );
    await client.query(
      "DELETE FROM travels_connected_calendars WHERE user_id = $1",
      p,
    );
    // Reminder leaf tables before trips
    await client.query(
      "DELETE FROM travels_reminder_calendar_events WHERE user_id = $1",
      p,
    );
    await client.query(
      "DELETE FROM travels_reminder_alert_log WHERE user_id = $1",
      p,
    );
    // travels_reminder_alert_deliveries: raw-SQL-only table, user_id NOT NULL,
    // no FK cascade — must be deleted before reminders and app_users.
    await client.query(
      "DELETE FROM travels_reminder_alert_deliveries WHERE user_id = $1",
      p,
    );
    await client.query("DELETE FROM travels_reminders WHERE user_id = $1", p);
    // Generic cross-app reminders (reminder_deliveries and
    // reminder_calendar_sync_state cascade via their reminder_id FK).
    await client.query(
      "DELETE FROM reminders WHERE created_by_user_id = $1",
      p,
    );
    // Trip content leaf tables
    await client.query("DELETE FROM travels_trip_photos WHERE user_id = $1", p);
    await client.query(
      "DELETE FROM travels_trip_documents WHERE user_id = $1",
      p,
    );
    await client.query("DELETE FROM travels_wishlist WHERE user_id = $1", p);
    await client.query(
      "DELETE FROM travels_gmail_scan_decisions WHERE user_id = $1",
      p,
    );
    // packing_items FK → packing_lists (no CASCADE); packing_lists FK → trips
    await client.query(
      "DELETE FROM travels_packing_items WHERE list_id IN (SELECT id FROM travels_packing_lists WHERE trip_id IN (SELECT id FROM travels_trips WHERE user_id = $1))",
      p,
    );
    await client.query(
      "DELETE FROM travels_packing_lists WHERE trip_id IN (SELECT id FROM travels_trips WHERE user_id = $1)",
      p,
    );
    // trips: cascades to any remaining child rows linked by trip_id FK
    await client.query("DELETE FROM travels_trips WHERE user_id = $1", p);
    await client.query(
      "DELETE FROM travels_monitoring_preferences WHERE user_id = $1",
      p,
    );
    // travels_calendar_settings is a singleton row (id=1), no user_id column.

    // ── 4. Delete Pottery data ───────────────────────────────────────────────
    // pottery_items cascades to pottery_images, pottery_item_categories,
    // pottery analyses etc. via their item_id FKs.
    await client.query("DELETE FROM pottery_items WHERE user_id = $1", p);
    await client.query("DELETE FROM pottery_categories WHERE user_id = $1", p);

    // ── 5. Delete Quilting data ──────────────────────────────────────────────
    // fabrics/blocks/patterns/layouts cascade to their child tables.
    await client.query("DELETE FROM quilting_fabrics WHERE user_id = $1", p);
    await client.query("DELETE FROM quilting_categories WHERE user_id = $1", p);
    await client.query("DELETE FROM quilting_patterns WHERE user_id = $1", p);
    await client.query(
      "DELETE FROM quilting_finished_quilts WHERE user_id = $1",
      p,
    );
    await client.query("DELETE FROM quilting_blocks WHERE user_id = $1", p);
    await client.query("DELETE FROM quilting_layouts WHERE user_id = $1", p);
    await client.query(
      "DELETE FROM quilting_shopping_items WHERE user_id = $1",
      p,
    );

    // ── 6. Delete Ornaments data ─────────────────────────────────────────────
    // ornaments_items cascades to ornaments_images, ornaments_item_categories.
    await client.query("DELETE FROM ornaments_items WHERE user_id = $1", p);
    await client.query(
      "DELETE FROM ornaments_categories WHERE user_id = $1",
      p,
    );

    // ── 7. Delete other user-scoped rows ─────────────────────────────────────
    // messenger_messages.sender_id is nullable with NO ACTION — null it before
    // removing the user row, preserving the household's message history.
    await client.query(
      "UPDATE messenger_messages SET sender_id = NULL WHERE sender_id = $1",
      p,
    );
    await client.query(
      "DELETE FROM messenger_conversation_participants WHERE user_id = $1",
      p,
    );
    await client.query("DELETE FROM market_watches WHERE user_id = $1", p);
    // notification_deliveries has a FK to notification_recipients without CASCADE
    await client.query(
      "DELETE FROM notification_deliveries WHERE recipient_id IN (SELECT id FROM notification_recipients WHERE user_id = $1)",
      p,
    );
    await client.query(
      "DELETE FROM notification_recipients WHERE user_id = $1",
      p,
    );
    await client.query(
      "DELETE FROM notification_preferences WHERE user_id = $1",
      p,
    );
    await client.query(
      "DELETE FROM similarity_evaluations WHERE user_id = $1",
      p,
    );

    // ── 8. Delete the user ───────────────────────────────────────────────────
    // ON DELETE CASCADE in the live schema handles: phone_verification_codes,
    // password_reset_tokens, messenger_reactions, messenger_push_subscriptions,
    // elaine_slack_conversations.
    // ON DELETE SET NULL handles: ai_generation_runs, ai_field_decisions,
    // knowledge_entities, knowledge_domain_links, search_feedback,
    // ingestion_runs, external_operation_events, app_jobs.
    await client.query("DELETE FROM app_users WHERE id = $1", p);

    await client.query("COMMIT");
    res.json({ deleted: true });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

export default router;
