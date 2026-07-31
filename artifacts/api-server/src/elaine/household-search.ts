/**
 * searchHouseholdData
 *
 * Core implementation of Elaine's `search_household_data` tool.  Extracted
 * from the main router so it can be unit-tested in isolation — the critical
 * property being that soft-deleted items (deletedAt IS NOT NULL) must never
 * be included in any search results returned to the model.
 */

import { and, isNull, ilike, or, desc } from "drizzle-orm";
import {
  db,
  fabrics,
  finishedQuilts,
  ornamentsItems,
  potteryItems,
  quiltPatterns,
  travelsTrips,
} from "@workspace/db";

export type SearchDomain =
  | "trips"
  | "pottery"
  | "ornaments"
  | "fabrics"
  | "patterns"
  | "quilts";

export async function searchHouseholdData(
  query: string,
  domains: SearchDomain[],
): Promise<string> {
  const pat = `%${query}%`;
  const parts: string[] = [];

  if (domains.includes("trips")) {
    const rows = await db
      .select({
        id: travelsTrips.id,
        title: travelsTrips.title,
        destination: travelsTrips.destination,
        status: travelsTrips.status,
        startDate: travelsTrips.startDate,
        endDate: travelsTrips.endDate,
        itinerary: travelsTrips.itinerary,
      })
      .from(travelsTrips)
      .where(
        and(
          isNull(travelsTrips.deletedAt),
          or(
            ilike(travelsTrips.title, pat),
            ilike(travelsTrips.destination, pat),
          ),
        ),
      )
      .orderBy(desc(travelsTrips.startDate))
      .limit(5);
    if (rows.length > 0) {
      const lines = rows.map((t) => {
        const dates =
          t.startDate && t.endDate
            ? ` ${t.startDate} to ${t.endDate}`
            : t.startDate
              ? ` starting ${t.startDate}`
              : "";
        let line = `- "${t.title}" (${t.destination ?? "no destination"}), status: ${t.status}${dates}, tripId: ${t.id}`;
        // Append itinerary activities so Elaine can answer hotel/flight/activity questions
        const itin = t.itinerary as {
          days?: Array<{
            date?: string;
            title?: string;
            activities?: Array<{
              time?: string;
              name?: string;
              description?: string;
            }>;
          }>;
        } | null;
        if (itin?.days && itin.days.length > 0) {
          const dayLines = itin.days
            .map((day) => {
              const dayHeader = [day.date, day.title]
                .filter(Boolean)
                .join(" – ");
              const actLines = (day.activities ?? [])
                .map((a) => {
                  const t2 = a.time ? `${a.time}: ` : "";
                  return `      • ${t2}${a.name ?? a.description ?? "activity"}`;
                })
                .join("\n");
              return `    Day (${dayHeader}):\n${actLines}`;
            })
            .join("\n");
          line += `\n  Itinerary:\n${dayLines}`;
        }
        return line;
      });
      parts.push(
        `Found ${rows.length} trip(s) matching "${query}":\n${lines.join("\n\n")}\nCall show_trip_card with the trip data and tripId to show a visual card.`,
      );
    } else {
      parts.push(`No trips found matching "${query}".`);
    }
  }

  if (domains.includes("pottery")) {
    const rows = await db
      .select({
        id: potteryItems.id,
        name: potteryItems.name,
        maker: potteryItems.maker,
        style: potteryItems.style,
      })
      .from(potteryItems)
      .where(
        and(
          isNull(potteryItems.deletedAt),
          or(ilike(potteryItems.name, pat), ilike(potteryItems.maker, pat)),
        ),
      )
      .limit(5);
    if (rows.length > 0) {
      const lines = rows.map(
        (r) =>
          `- "${r.name}"${r.maker ? ` by ${r.maker}` : ""}${r.style ? `, ${r.style}` : ""}, itemId: ${r.id}`,
      );
      parts.push(
        `Found ${rows.length} pottery piece(s) matching "${query}":\n${lines.join("\n")}\nCall show_pottery_item with the itemId to show a visual card.`,
      );
    } else {
      parts.push(`No pottery pieces found matching "${query}".`);
    }
  }

  if (domains.includes("ornaments")) {
    const rows = await db
      .select({
        id: ornamentsItems.id,
        name: ornamentsItems.name,
        seriesOrCollection: ornamentsItems.seriesOrCollection,
        year: ornamentsItems.year,
      })
      .from(ornamentsItems)
      .where(
        and(
          isNull(ornamentsItems.deletedAt),
          or(
            ilike(ornamentsItems.name, pat),
            ilike(ornamentsItems.seriesOrCollection, pat),
          ),
        ),
      )
      .limit(5);
    if (rows.length > 0) {
      const lines = rows.map(
        (r) =>
          `- "${r.name}"${r.seriesOrCollection ? `, ${r.seriesOrCollection}` : ""}${r.year ? ` (${r.year})` : ""}, itemId: ${r.id}`,
      );
      parts.push(
        `Found ${rows.length} ornament(s) matching "${query}":\n${lines.join("\n")}`,
      );
    } else {
      parts.push(`No ornaments found matching "${query}".`);
    }
  }

  if (domains.includes("fabrics")) {
    const rows = await db
      .select({
        id: fabrics.id,
        name: fabrics.name,
        designer: fabrics.designer,
        manufacturer: fabrics.manufacturer,
      })
      .from(fabrics)
      .where(
        and(
          isNull(fabrics.deletedAt),
          or(
            ilike(fabrics.name, pat),
            ilike(fabrics.designer, pat),
            ilike(fabrics.manufacturer, pat),
          ),
        ),
      )
      .limit(5);
    if (rows.length > 0) {
      const lines = rows.map(
        (r) =>
          `- "${r.name}"${r.designer ? ` by ${r.designer}` : ""}${r.manufacturer ? `, ${r.manufacturer}` : ""}, fabricId: ${r.id}`,
      );
      parts.push(
        `Found ${rows.length} fabric(s) matching "${query}":\n${lines.join("\n")}\nCall show_fabric_swatch with the fabricId to show a visual card.`,
      );
    } else {
      parts.push(`No fabrics found matching "${query}".`);
    }
  }

  if (domains.includes("patterns")) {
    const rows = await db
      .select({
        id: quiltPatterns.id,
        name: quiltPatterns.name,
        designer: quiltPatterns.designer,
      })
      .from(quiltPatterns)
      .where(
        and(
          isNull(quiltPatterns.deletedAt),
          or(
            ilike(quiltPatterns.name, pat),
            ilike(quiltPatterns.designer, pat),
          ),
        ),
      )
      .limit(5);
    if (rows.length > 0) {
      const lines = rows.map(
        (r) =>
          `- "${r.name}"${r.designer ? ` by ${r.designer}` : ""}, patternId: ${r.id}`,
      );
      parts.push(
        `Found ${rows.length} quilt pattern(s) matching "${query}":\n${lines.join("\n")}`,
      );
    } else {
      parts.push(`No quilt patterns found matching "${query}".`);
    }
  }

  if (domains.includes("quilts")) {
    const rows = await db
      .select({
        id: finishedQuilts.id,
        name: finishedQuilts.name,
        dateCompleted: finishedQuilts.dateCompleted,
      })
      .from(finishedQuilts)
      .where(
        and(
          isNull(finishedQuilts.deletedAt),
          ilike(finishedQuilts.name, pat),
        ),
      )
      .limit(5);
    if (rows.length > 0) {
      const lines = rows.map(
        (r) =>
          `- "${r.name}"${r.dateCompleted ? ` (completed ${r.dateCompleted})` : ""}, quiltId: ${r.id}`,
      );
      parts.push(
        `Found ${rows.length} finished quilt(s) matching "${query}":\n${lines.join("\n")}`,
      );
    } else {
      parts.push(`No finished quilts found matching "${query}".`);
    }
  }

  return parts.length > 0
    ? parts.join("\n\n")
    : `No results found for "${query}".`;
}
