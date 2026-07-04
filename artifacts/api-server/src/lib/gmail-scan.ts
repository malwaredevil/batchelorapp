/**
 * Scan a connected household member's Gmail inbox for travel booking emails
 * (flights/trains/hotels/car rentals), AI-extract structured fields, and
 * record one permanent decision row per Gmail message so a message is never
 * re-surfaced once it's been reviewed — mirrors travels-calendar-scan.ts's
 * "decision ledger + dedupeKey" idempotency approach, but scoped per-message
 * rather than per-cluster.
 *
 * Household-wide dedup: two people on the same household often both receive
 * the same airline/hotel confirmation email. Once one person's copy is
 * linked to a trip, the identical email at another connected address is
 * auto-marked "ignored" (never surfaced) using a dedupeKey derived from the
 * normalized provider + reference number + first travel date, which is
 * stable across mailboxes even though the raw message ids differ.
 */
import crypto from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { db, travelsGmailScanDecisions, travelsTrips } from "@workspace/db";
import { getAllGmailConnections, getValidGmailAccessToken } from "./gmail-tokens";
import { searchMessages, getMessage, parseGmailMessage, type GmailMessageListItem } from "./gmail-api";
import { extractFromEmailText } from "./travel-document-extraction";
import { TRAVEL_LABEL_NAME } from "./gmail-labels";
import { logger } from "./logger";

// Scoped to booking/confirmation-style subjects to keep both the Gmail
// search result set and the downstream AI classification cost bounded —
// this is a coarse pre-filter, extractFromEmailText makes the real call.
const GMAIL_SEARCH_QUERY =
  '(subject:(flight OR itinerary OR "boarding pass" OR "e-ticket" OR eticket OR reservation OR booking OR confirmation OR "check-in" OR hotel OR train OR "car rental" OR "rental car")) -category:promotions -category:social newer_than:180d';

// Emails the user has already hand-labeled "Travel" in Gmail are trusted
// candidates too — they skip the coarse subject pre-filter above but still
// go through the same AI classification/extraction below.
const GMAIL_LABEL_SEARCH_QUERY = `label:"${TRAVEL_LABEL_NAME}" newer_than:180d`;

const MAX_MESSAGES_PER_SCAN = 150;
const MAX_LABELED_MESSAGES_PER_SCAN = 100;

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * A household-stable identity for a booking, independent of which mailbox
 * received it: provider + reference number when both are present (the
 * strongest signal), otherwise provider + first travel date + route as a
 * fallback for confirmations that omit an explicit reference number.
 */
function dedupeKeyFor(extracted: Record<string, unknown>): string | null {
  const provider = normalize(extracted.providerName as string | undefined);
  const reference = normalize(extracted.referenceNumber as string | undefined);
  if (provider && reference) {
    return crypto.createHash("sha1").update(`${provider}|${reference}`).digest("hex");
  }
  const firstDate = normalize(
    (extracted.departureDateTime ?? extracted.checkInDate ?? extracted.pickupDateTime) as
      | string
      | undefined,
  );
  const from = normalize(extracted.fromLocation as string | undefined);
  const to = normalize(extracted.toLocation as string | undefined);
  if (provider && firstDate && (from || to)) {
    return crypto
      .createHash("sha1")
      .update(`${provider}|${firstDate}|${from}|${to}`)
      .digest("hex");
  }
  return null;
}

function toDateOnly(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Best-effort match against the household's existing trips: a booking
 * "belongs" to a trip if its travel date falls inside (or within a day of)
 * that trip's date range. Returns null rather than guessing when no trip
 * lines up — the review UI lets the user pick manually in that case.
 */
async function suggestTripId(extracted: Record<string, unknown>): Promise<number | null> {
  const travelDate = toDateOnly(
    (extracted.departureDateTime ??
      extracted.checkInDate ??
      extracted.pickupDateTime) as string | undefined,
  );
  if (!travelDate) return null;

  const trips = await db
    .select({ id: travelsTrips.id, startDate: travelsTrips.startDate, endDate: travelsTrips.endDate })
    .from(travelsTrips);

  const target = new Date(travelDate).getTime();
  const DAY_MS = 86_400_000;
  for (const trip of trips) {
    if (!trip.startDate) continue;
    const start = new Date(trip.startDate).getTime() - DAY_MS;
    const end = trip.endDate ? new Date(trip.endDate).getTime() + DAY_MS : start + DAY_MS;
    if (target >= start && target <= end) return trip.id;
  }
  return null;
}

export interface GmailScanResult {
  userId: number;
  scanned: number;
  created: number;
  autoIgnoredDuplicates: number;
}

async function scanConnectionForTravelDocuments(userId: number): Promise<GmailScanResult> {
  const accessToken = await getValidGmailAccessToken(userId);
  if (!accessToken) {
    return { userId, scanned: 0, created: 0, autoIgnoredDuplicates: 0 };
  }

  const [keywordMessages, labeledMessages] = await Promise.all([
    searchMessages(accessToken, GMAIL_SEARCH_QUERY, MAX_MESSAGES_PER_SCAN),
    searchMessages(accessToken, GMAIL_LABEL_SEARCH_QUERY, MAX_LABELED_MESSAGES_PER_SCAN).catch(
      (err: unknown) => {
        logger.warn({ err, userId }, "gmail-scan: label-based search failed, continuing with keyword results only");
        return [] as GmailMessageListItem[];
      },
    ),
  ]);
  const seenIds = new Set<string>();
  const messages = [...keywordMessages, ...labeledMessages].filter((m) => {
    if (seenIds.has(m.id)) return false;
    seenIds.add(m.id);
    return true;
  });

  // Never re-fetch/re-classify a message we've already made a decision on —
  // this is the "never revisit decided emails" guarantee.
  const alreadyDecided = new Set(
    (
      await db
        .select({ gmailMessageId: travelsGmailScanDecisions.gmailMessageId })
        .from(travelsGmailScanDecisions)
        .where(eq(travelsGmailScanDecisions.userId, userId))
    ).map((r) => r.gmailMessageId),
  );

  const toProcess = messages.filter((m) => !alreadyDecided.has(m.id));
  let created = 0;
  let autoIgnoredDuplicates = 0;

  for (const item of toProcess) {
    try {
      const full = await getMessage(accessToken, item.id);
      const parsed = parseGmailMessage(full);
      const extracted = await extractFromEmailText(
        parsed.subject ?? "(no subject)",
        parsed.from ?? "",
        parsed.textBody,
      );

      if (!extracted.isTravelRelated) {
        await db
          .insert(travelsGmailScanDecisions)
          .values({
            userId,
            gmailMessageId: item.id,
            threadId: item.threadId,
            subject: parsed.subject,
            fromAddress: parsed.from,
            receivedAt: parsed.date,
            status: "ignored",
          })
          .onConflictDoNothing();
        continue;
      }

      const dedupeKey = dedupeKeyFor(extracted);

      // Household-wide dedup: if any OTHER user already linked an email with
      // this same dedupeKey to a trip, this is the same booking landing in a
      // second inbox — auto-ignore it instead of showing a duplicate card.
      if (dedupeKey) {
        const [existingLinked] = await db
          .select({ id: travelsGmailScanDecisions.id })
          .from(travelsGmailScanDecisions)
          .where(
            and(
              eq(travelsGmailScanDecisions.dedupeKey, dedupeKey),
              eq(travelsGmailScanDecisions.status, "linked"),
              ne(travelsGmailScanDecisions.userId, userId),
            ),
          )
          .limit(1);
        if (existingLinked) {
          await db
            .insert(travelsGmailScanDecisions)
            .values({
              userId,
              gmailMessageId: item.id,
              threadId: item.threadId,
              subject: parsed.subject,
              fromAddress: parsed.from,
              receivedAt: parsed.date,
              status: "ignored",
              extractedData: extracted,
              dedupeKey,
            })
            .onConflictDoNothing();
          autoIgnoredDuplicates += 1;
          continue;
        }
      }

      const suggestedTripId = await suggestTripId(extracted);

      const result = await db
        .insert(travelsGmailScanDecisions)
        .values({
          userId,
          gmailMessageId: item.id,
          threadId: item.threadId,
          subject: parsed.subject,
          fromAddress: parsed.from,
          receivedAt: parsed.date,
          status: "pending",
          extractedData: extracted,
          dedupeKey,
          suggestedTripId,
        })
        .onConflictDoNothing()
        .returning({ id: travelsGmailScanDecisions.id });

      if (result.length > 0) created += 1;
    } catch (err) {
      logger.warn(
        { err, userId, messageId: item.id },
        "gmail-scan: failed to process message, skipping",
      );
    }
  }

  return { userId, scanned: toProcess.length, created, autoIgnoredDuplicates };
}

/**
 * Scan every connected household Gmail account for new travel booking
 * emails. Best-effort per connection — one user's failure (revoked token,
 * transient API error) never blocks the others.
 */
export async function scanAllGmailConnections(): Promise<GmailScanResult[]> {
  const connections = await getAllGmailConnections();
  const results: GmailScanResult[] = [];
  for (const conn of connections) {
    try {
      results.push(await scanConnectionForTravelDocuments(conn.userId));
    } catch (err) {
      logger.warn({ err, userId: conn.userId }, "gmail-scan: connection scan failed");
      results.push({ userId: conn.userId, scanned: 0, created: 0, autoIgnoredDuplicates: 0 });
    }
  }
  return results;
}

export async function scanGmailForUser(userId: number): Promise<GmailScanResult> {
  return scanConnectionForTravelDocuments(userId);
}

const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

/**
 * Best-effort in-process scheduler, same caveat as other schedulers in this
 * codebase (see travels-nudges.ts / travels-calendar-scan.ts): an autoscale
 * instance can sleep for long stretches, so this is a convenience, not a
 * delivery guarantee. The per-message unique index + decision ledger keep
 * this safely idempotent alongside the manual "Scan now" button.
 */
export function startGmailScanScheduler(): void {
  scanAllGmailConnections().catch((err: unknown) =>
    logger.error({ err }, "gmail-scan: initial run failed"),
  );

  const interval = setInterval(() => {
    scanAllGmailConnections().catch((err: unknown) =>
      logger.error({ err }, "gmail-scan: scheduled run failed"),
    );
  }, SCAN_INTERVAL_MS);

  interval.unref();

  logger.info("gmail-scan: started (in-process fallback, runs every 6h)");
}
