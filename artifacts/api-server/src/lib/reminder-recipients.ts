import { and, eq, inArray } from "drizzle-orm";
import { db, appUsers } from "@workspace/db";

// Shared recipient-validation helpers for the generic reminder system.
// Originally lived only in routes/travels/reminders.ts; extracted so the
// central Reminders page (issue #524) validates recipients the exact same
// way instead of re-implementing the same two queries.

// Only household members with a verified phone number can be selected as
// SMS/call recipients — silently drops any id that isn't verified rather
// than rejecting the whole request, since the set may include a user who
// unverified their phone between selection and save.
export async function filterVerifiedPhoneUserIds(
  userIds: number[],
): Promise<number[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(
      and(inArray(appUsers.id, userIds), eq(appUsers.phoneVerified, true)),
    );
  return rows.map((r) => r.id);
}

// Only household members who have linked a Slack account can be selected as
// Slack recipients — same silent-drop convention as the phone check above.
export async function filterSlackLinkedUserIds(
  userIds: number[],
): Promise<number[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ id: appUsers.id, slackUserId: appUsers.slackUserId })
    .from(appUsers)
    .where(inArray(appUsers.id, userIds));
  return rows.filter((r) => !!r.slackUserId).map((r) => r.id);
}
