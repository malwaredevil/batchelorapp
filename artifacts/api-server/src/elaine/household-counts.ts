/**
 * queryHouseholdData
 *
 * Core implementation of Elaine's `query_household_data` tool.  Extracted
 * from the main router so it can be unit-tested in isolation — the critical
 * property being that soft-deleted items (deletedAt IS NOT NULL) must never
 * be included in any count returned to the model.
 */

import { and, count, desc, inArray, isNull } from "drizzle-orm";
import {
  db,
  fabrics,
  finishedQuilts,
  ornamentsItems,
  potteryItems,
  quiltPatterns,
  travelsTrips,
  travelsWishlist,
} from "@workspace/db";
import { getAllConfig } from "../lib/app-config";

export async function queryHouseholdData(include: string[]): Promise<string> {
  const parts: string[] = [];

  if (include.includes("pottery")) {
    const [row] = await db
      .select({ total: count() })
      .from(potteryItems)
      .where(isNull(potteryItems.deletedAt));
    const recent = await db
      .select({ name: potteryItems.name })
      .from(potteryItems)
      .where(isNull(potteryItems.deletedAt))
      .orderBy(desc(potteryItems.createdAt))
      .limit(3);
    parts.push(
      `Pottery collection: ${row?.total ?? 0} pieces total.` +
        (recent.length > 0
          ? ` Recently added: ${recent.map((r) => r.name).join(", ")}.`
          : ""),
    );
  }

  if (include.includes("quilting")) {
    const [fabRow] = await db
      .select({ total: count() })
      .from(fabrics)
      .where(isNull(fabrics.deletedAt));
    const [patRow] = await db
      .select({ total: count() })
      .from(quiltPatterns)
      .where(isNull(quiltPatterns.deletedAt));
    const [quiltRow] = await db
      .select({ total: count() })
      .from(finishedQuilts)
      .where(isNull(finishedQuilts.deletedAt));
    parts.push(
      `Quilting stash: ${fabRow?.total ?? 0} fabrics, ${patRow?.total ?? 0} patterns, ${quiltRow?.total ?? 0} finished quilts.`,
    );
  }

  if (include.includes("ornaments")) {
    const [ornRow] = await db
      .select({ total: count() })
      .from(ornamentsItems)
      .where(isNull(ornamentsItems.deletedAt));
    const ornRecent = await db
      .select({ name: ornamentsItems.name })
      .from(ornamentsItems)
      .where(isNull(ornamentsItems.deletedAt))
      .orderBy(desc(ornamentsItems.createdAt))
      .limit(3);
    parts.push(
      `Ornaments collection: ${ornRow?.total ?? 0} ornaments total.` +
        (ornRecent.length > 0
          ? ` Recently added: ${ornRecent.map((r) => r.name).join(", ")}.`
          : ""),
    );
  }

  if (include.includes("travels")) {
    const [wishRow] = await db.select({ total: count() }).from(travelsWishlist);
    const activeTrips = await db
      .select({
        id: travelsTrips.id,
        title: travelsTrips.title,
        destination: travelsTrips.destination,
        status: travelsTrips.status,
        startDate: travelsTrips.startDate,
        endDate: travelsTrips.endDate,
      })
      .from(travelsTrips)
      .where(
        and(
          isNull(travelsTrips.deletedAt),
          inArray(travelsTrips.status, [
            "planning",
            "booked",
            "active",
          ] as string[]),
        ),
      )
      .orderBy(travelsTrips.startDate);
    const formatRange = (start: string | null, end: string | null) => {
      if (!start && !end) return "dates not set yet";
      if (start && end) return `${start} to ${end}`;
      return start ? `starting ${start}` : `ending ${end}`;
    };
    parts.push(
      `Travels: ${activeTrips.length} active trip(s), ${wishRow?.total ?? 0} on the wishlist.` +
        (activeTrips.length > 0
          ? " Active trips:\n" +
            activeTrips
              .map(
                (t) =>
                  `- ${t.title} (${t.destination}), status: ${t.status}, dates: ${formatRange(t.startDate, t.endDate)}, tripId: ${t.id}`,
              )
              .join("\n")
          : ""),
    );
  }

  if (include.includes("app_config")) {
    const configRows = await getAllConfig();
    if (configRows.length > 0) {
      const configByModule: Record<string, string[]> = {};
      for (const r of configRows) {
        if (!configByModule[r.module]) configByModule[r.module] = [];
        configByModule[r.module].push(`  ${r.key}: ${r.value} — ${r.label}`);
      }
      const configText = Object.entries(configByModule)
        .map(([mod, lines]) => `${mod}:\n${lines.join("\n")}`)
        .join("\n");
      parts.push(`Control Panel settings (current values):\n${configText}`);
    }
  }

  return parts.length > 0 ? parts.join("\n") : "No household data found.";
}
