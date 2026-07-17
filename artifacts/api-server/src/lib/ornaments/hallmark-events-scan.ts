// The ornaments_hallmark_events DB table has been removed.
// The AI auto-discovery scan previously inserted rows into that table and is
// now a no-op. Hallmark events are written directly to Google Calendar via
// the CRUD routes (POST/PATCH/DELETE /api/ornaments/hallmark-events).
import { logger } from "../logger";

export interface HallmarkEventScanResult {
  searched: number;
  discovered: number;
  created: number;
  skippedDuplicates: number;
}

export async function scanForHallmarkEvents(): Promise<HallmarkEventScanResult> {
  logger.info(
    "hallmark-events-scan: disabled (DB table removed; use GCal CRUD routes)",
  );
  return { searched: 0, discovered: 0, created: 0, skippedDuplicates: 0 };
}

export function startHallmarkEventsScanScheduler(): void {
  logger.info("hallmark-events-scan: scheduler disabled (DB table removed)");
}
