import { db } from "@workspace/db";
import { logger } from "./logger";

let _householdActivityLog:
  | typeof import("@workspace/db").householdActivityLog
  | null = null;
async function getLogTable() {
  if (!_householdActivityLog) {
    const mod = await import("@workspace/db");
    _householdActivityLog = mod.householdActivityLog;
  }
  return _householdActivityLog;
}

export interface LogActivityOpts {
  actorUserId: number | null;
  actorChannel: string;
  actionType: string;
  entityType: string;
  entityId?: number;
  entityLabel?: string;
  payload?: Record<string, unknown>;
  reversible?: boolean;
}

/**
 * Write one row to household_activity_log AND emit a structured logger.info
 * line that appears in Sentry breadcrumbs + deployment logs.
 *
 * Fire-and-forget safe — never throws, logs failures at error level.
 */
export async function logActivity(opts: LogActivityOpts): Promise<void> {
  logger.info(
    {
      actorUserId: opts.actorUserId,
      actorChannel: opts.actorChannel,
      actionType: opts.actionType,
      entityType: opts.entityType,
      entityId: opts.entityId,
      entityLabel: opts.entityLabel,
    },
    "household_activity",
  );

  try {
    const table = await getLogTable();
    await db.insert(table).values({
      actorUserId: opts.actorUserId ?? null,
      actorChannel: opts.actorChannel,
      actionType: opts.actionType,
      entityType: opts.entityType,
      entityId: opts.entityId ?? null,
      entityLabel: opts.entityLabel ?? null,
      payload: opts.payload ?? null,
      reversible: opts.reversible ?? false,
    });
  } catch (err) {
    logger.error({ err }, "household_activity_log: write failed");
  }
}
