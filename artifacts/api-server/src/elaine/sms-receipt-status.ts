import { and, eq, inArray } from "drizzle-orm";
import { db, elaineCommunicationReceipts, reminders } from "@workspace/db";
import { getSmsMessageStatuses } from "../lib/sms";
import { logger } from "../lib/logger";
import { listCommunicationReceipts } from "./communication-receipts";

/**
 * Refresh only this caller's already-recorded SMS attempts. Never send,
 * infer delivery from acceptance, or overwrite a settled/cancelled receipt.
 */
export async function readCommunicationReceipts(
  params: Parameters<typeof listCommunicationReceipts>[0],
) {
  const rows: (Awaited<ReturnType<typeof listCommunicationReceipts>>[number] & {
    scheduledFor?: string | null;
  })[] = await listCommunicationReceipts(params);
  const scheduledIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.scheduledActionId == null ? [] : [row.scheduledActionId],
      ),
    ),
  ];
  if (scheduledIds.length) {
    const schedules = await db
      .select({ id: reminders.id, dueAt: reminders.dueAt })
      .from(reminders)
      .where(
        and(
          inArray(reminders.id, scheduledIds),
          eq(reminders.createdByUserId, params.ownerUserId),
        ),
      );
    const byId = new Map(
      schedules.map((row) => [row.id, row.dueAt?.toISOString() ?? null]),
    );
    for (const row of rows) {
      if (row.scheduledActionId != null)
        row.scheduledFor = byId.get(row.scheduledActionId) ?? null;
    }
  }
  if (
    !rows.some(
      (row) =>
        row.channel === "sms" &&
        row.providerId &&
        ["accepted", "unknown", "executing"].includes(row.status),
    )
  )
    return rows;
  try {
    const statuses = await getSmsMessageStatuses();
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      if (
        row.channel !== "sms" ||
        !row.providerId ||
        !["accepted", "unknown", "executing"].includes(row.status)
      )
        continue;
      const providerStatus = statuses.get(row.providerId);
      const status =
        providerStatus === "delivered" || providerStatus === "read"
          ? "completed"
          : providerStatus === "failed" || providerStatus === "undelivered"
            ? "failed"
            : null;
      if (!status) continue;
      const [updated] = await db
        .update(elaineCommunicationReceipts)
        .set({ status, updatedAt: new Date() })
        .where(
          and(
            eq(elaineCommunicationReceipts.id, row.id),
            eq(elaineCommunicationReceipts.ownerUserId, params.ownerUserId),
            eq(elaineCommunicationReceipts.channel, "sms"),
            eq(elaineCommunicationReceipts.providerId, row.providerId),
            inArray(elaineCommunicationReceipts.status, [
              "accepted",
              "unknown",
              "executing",
            ]),
          ),
        )
        .returning();
      if (updated) rows[index] = { ...updated, scheduledFor: row.scheduledFor };
    }
  } catch (error) {
    logger.warn(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      "SMS delivery verification unavailable; preserving recorded receipts",
    );
  }
  return rows;
}
