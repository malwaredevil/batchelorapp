import { Router, type IRouter } from "express";
import { and, eq, ilike, or } from "drizzle-orm";
import {
  db,
  potteryItems,
  fabrics,
  quiltPatterns,
  finishedQuilts,
  travelsTrips,
  travelsReminders,
  elaineHistoryConversations,
  elaineHistoryMessages,
} from "@workspace/db";
import { requireAuth } from "../middleware/auth";

const router: IRouter = Router();

const SNIPPET_RADIUS = 40;
const SNIPPET_MAX_LENGTH = 140;

/**
 * Builds a short excerpt of `content` centered on the first case-insensitive
 * occurrence of `query`, so search results can show the matching text rather
 * than a generic label.
 */
function buildMessageSnippet(content: string, query: string): string | undefined {
  const normalizedContent = content.replace(/\s+/g, " ").trim();
  if (!normalizedContent) return undefined;

  const matchIndex = normalizedContent.toLowerCase().indexOf(query.toLowerCase());
  if (matchIndex === -1) {
    return normalizedContent.length > SNIPPET_MAX_LENGTH
      ? `${normalizedContent.slice(0, SNIPPET_MAX_LENGTH).trimEnd()}…`
      : normalizedContent;
  }

  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(
    normalizedContent.length,
    matchIndex + query.length + SNIPPET_RADIUS,
  );

  const prefix = start > 0 ? "…" : "";
  const suffix = end < normalizedContent.length ? "…" : "";
  return `${prefix}${normalizedContent.slice(start, end).trim()}${suffix}`;
}

router.get("/search", requireAuth, async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const limit = Math.min(Math.max(Number(req.query.limit ?? 24), 1), 50);

  if (!q) {
    res.json({ groups: [] });
    return;
  }

  const pattern = `%${q}%`;
  const perSource = Math.max(4, Math.ceil(limit / 6));
  const userId = req.session.userId!;

  const [
    potteryResults,
    fabricResults,
    patternResults,
    quiltResults,
    tripResults,
    reminderResults,
    conversationTitleMatches,
    conversationContentMatches,
  ] = await Promise.all([
    db
      .select({ id: potteryItems.id, name: potteryItems.name, maker: potteryItems.maker })
      .from(potteryItems)
      .where(
        or(
          ilike(potteryItems.name, pattern),
          ilike(potteryItems.maker, pattern),
          ilike(potteryItems.patternDescription, pattern),
        ),
      )
      .limit(perSource),

    db
      .select({ id: fabrics.id, name: fabrics.name, designer: fabrics.designer, lineName: fabrics.lineName })
      .from(fabrics)
      .where(or(ilike(fabrics.name, pattern), ilike(fabrics.designer, pattern)))
      .limit(perSource),

    db
      .select({ id: quiltPatterns.id, name: quiltPatterns.name, designer: quiltPatterns.designer })
      .from(quiltPatterns)
      .where(or(ilike(quiltPatterns.name, pattern), ilike(quiltPatterns.designer, pattern)))
      .limit(perSource),

    db
      .select({ id: finishedQuilts.id, name: finishedQuilts.name })
      .from(finishedQuilts)
      .where(ilike(finishedQuilts.name, pattern))
      .limit(perSource),

    db
      .select({ id: travelsTrips.id, title: travelsTrips.title, destination: travelsTrips.destination })
      .from(travelsTrips)
      .where(or(ilike(travelsTrips.title, pattern), ilike(travelsTrips.destination, pattern)))
      .limit(perSource),

    db
      .select({ id: travelsReminders.id, title: travelsReminders.title, tripId: travelsReminders.tripId })
      .from(travelsReminders)
      .where(ilike(travelsReminders.title, pattern))
      .limit(perSource),

    db
      .select({
        id: elaineHistoryConversations.id,
        title: elaineHistoryConversations.title,
        updatedAt: elaineHistoryConversations.updatedAt,
      })
      .from(elaineHistoryConversations)
      .where(
        and(
          eq(elaineHistoryConversations.userId, userId),
          ilike(elaineHistoryConversations.title, pattern),
        ),
      )
      .limit(perSource),

    db
      .select({
        id: elaineHistoryConversations.id,
        title: elaineHistoryConversations.title,
        updatedAt: elaineHistoryConversations.updatedAt,
        messageContent: elaineHistoryMessages.content,
      })
      .from(elaineHistoryMessages)
      .innerJoin(
        elaineHistoryConversations,
        eq(elaineHistoryMessages.conversationId, elaineHistoryConversations.id),
      )
      .where(
        and(
          eq(elaineHistoryConversations.userId, userId),
          ilike(elaineHistoryMessages.content, pattern),
        ),
      )
      .limit(perSource),
  ]);

  const conversationResultMap = new Map<
    number,
    { id: number; title: string; updatedAt: Date; snippet?: string }
  >();
  for (const r of conversationTitleMatches) {
    conversationResultMap.set(r.id, {
      id: r.id,
      title: r.title,
      updatedAt: r.updatedAt,
    });
  }
  for (const r of conversationContentMatches) {
    const existing = conversationResultMap.get(r.id);
    if (existing) {
      existing.snippet ??= buildMessageSnippet(r.messageContent, q);
    } else {
      conversationResultMap.set(r.id, {
        id: r.id,
        title: r.title,
        updatedAt: r.updatedAt,
        snippet: buildMessageSnippet(r.messageContent, q),
      });
    }
  }
  const conversationResults = Array.from(conversationResultMap.values())
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, perSource);

  const groups = [];

  if (tripResults.length > 0) {
    groups.push({
      type: "travels_trip",
      label: "Trips",
      results: tripResults.map((r) => ({
        id: r.id,
        title: r.title,
        subtitle: r.destination,
        url: `/travels/trips/${r.id}`,
      })),
    });
  }

  if (reminderResults.length > 0) {
    groups.push({
      type: "travels_reminder",
      label: "Reminders",
      results: reminderResults.map((r) => ({
        id: r.id,
        title: r.title,
        subtitle: "Trip reminder",
        url: `/travels/trips/${r.tripId}`,
      })),
    });
  }

  if (conversationResults.length > 0) {
    groups.push({
      type: "elaine_conversation",
      label: "Conversations",
      results: conversationResults.map((r) => ({
        id: r.id,
        title: r.title,
        subtitle: r.snippet ?? "Elaine conversation",
        matchedContent: Boolean(r.snippet),
        url: `/elaine/`,
      })),
    });
  }

  if (potteryResults.length > 0) {
    groups.push({
      type: "pottery",
      label: "Pottery",
      results: potteryResults.map((r) => ({
        id: r.id,
        title: r.name,
        subtitle: r.maker ?? undefined,
        url: `/pottery/piece/${r.id}`,
      })),
    });
  }

  if (fabricResults.length > 0) {
    groups.push({
      type: "quilting_fabric",
      label: "Fabrics",
      results: fabricResults.map((r) => ({
        id: r.id,
        title: r.name,
        subtitle: [r.designer, r.lineName].filter(Boolean).join(" · ") || undefined,
        url: `/quilting/fabrics/${r.id}`,
      })),
    });
  }

  if (patternResults.length > 0) {
    groups.push({
      type: "quilting_pattern",
      label: "Patterns",
      results: patternResults.map((r) => ({
        id: r.id,
        title: r.name,
        subtitle: r.designer ?? undefined,
        url: `/quilting/patterns/${r.id}`,
      })),
    });
  }

  if (quiltResults.length > 0) {
    groups.push({
      type: "quilting_quilt",
      label: "Quilts",
      results: quiltResults.map((r) => ({
        id: r.id,
        title: r.name,
        url: `/quilting/quilts/${r.id}`,
      })),
    });
  }

  res.json({ groups });
});

export default router;
