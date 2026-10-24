import type OpenAI from "openai";
import { z } from "zod/v4";
import { and, asc, count, eq, gt, isNull, lte, max } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { appUsers, db } from "@workspace/db";

const Cursor = z
  .object({
    afterId: z.number().int().nonnegative(),
    throughId: z.number().int().nonnegative(),
  })
  .strict()
  .refine((cursor) => cursor.afterId <= cursor.throughId);

export type CollectionReviewRow = { id: number; [key: string]: unknown };

export function collectionReviewEvidence(
  row: CollectionReviewRow,
  idKey: "itemId" | "fabricId",
  missingDecorativeDescription: boolean,
) {
  const { id, imagePath: _imagePath, ...metadata } = row;
  return {
    [idKey]: id,
    ...metadata,
    evidenceSource: "saved_catalog_metadata",
    photosInspected: 0,
    missingDecorativeDescription,
  };
}

/** Only explicitly selected saved metadata may be exposed to the model. */
export function createCollectionReviewReader(config: {
  domain: string;
  name: string;
  table: PgTable;
  id: AnyPgColumn;
  deletedAt: AnyPgColumn;
  columns: Record<string, AnyPgColumn> & { id: AnyPgColumn };
  pageSizeDefault: number;
  pageSizeMax: number;
  evidencePolicy: string;
  idKey: "itemId" | "fabricId";
  missingDescription: (row: CollectionReviewRow) => boolean;
}) {
  const payload = z
    .object({
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(config.pageSizeMax)
        .default(config.pageSizeDefault),
      cursor: Cursor.optional(),
    })
    .strict();

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: config.name,
        description: `Owner-authorized, read-only browse of ALL household ${config.domain}, not a keyword-search sample. Returns stable IDs, saved descriptions, explicit returned/remaining counts and nextCursor. Start without cursor, then pass each nextCursor unchanged until null. Deduplicate by stable ID and report actual unique records read versus total; never claim a full review if interrupted. New additions after the first page are excluded until a new browse. Evidence is saved catalog metadata, NOT fresh image inspection. Missing descriptions are unknown. Never reanalyze or modify records for a review.`,
        parameters: {
          type: "object",
          properties: {
            pageSize: {
              type: "integer",
              minimum: 1,
              maximum: config.pageSizeMax,
            },
            cursor: {
              type: "object",
              properties: {
                afterId: { type: "integer", minimum: 0 },
                throughId: { type: "integer", minimum: 0 },
              },
              required: ["afterId", "throughId"],
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
      },
    },
  ];

  async function browse(
    userId: number,
    argsJson: string,
    ownerVerified = true,
  ): Promise<string> {
    // Channel identity and database owner status are both required, before collection reads.
    if (!ownerVerified)
      return "Access denied — use signed-in owner chat or a verified owner channel.";
    const [user] = await db
      .select({ isOwner: appUsers.isOwner })
      .from(appUsers)
      .where(eq(appUsers.id, userId));
    if (!user?.isOwner)
      return `Access denied — only the app owner can browse ${config.domain} for a complete review.`;
    let input: z.infer<typeof payload>;
    try {
      input = payload.parse(JSON.parse(argsJson || "{}"));
    } catch {
      return `Invalid ${config.domain} browse parameters. Pass a valid returned cursor and an integer pageSize from 1 to ${config.pageSizeMax}.`;
    }
    // A stable upper ID excludes additions. Live edits/deletes can still change counts.
    const throughId =
      input.cursor?.throughId ??
      (
        await db
          .select({ value: max(config.id) })
          .from(config.table)
          .where(isNull(config.deletedAt))
      )[0]?.value ??
      0;
    const afterId = input.cursor?.afterId ?? 0;
    const scope = and(isNull(config.deletedAt), lte(config.id, throughId));
    const unreadScope = and(scope, gt(config.id, afterId));
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(config.table)
      .where(scope);
    const [{ value: unread }] = await db
      .select({ value: count() })
      .from(config.table)
      .where(unreadScope);
    const rows = (await db
      .select(config.columns)
      .from(config.table)
      .where(unreadScope)
      .orderBy(asc(config.id))
      .limit(input.pageSize)) as CollectionReviewRow[];
    const remaining = Math.max(0, unread - rows.length);
    const nextCursor =
      remaining > 0 && rows.length > 0
        ? { afterId: rows[rows.length - 1].id, throughId }
        : null;
    const missing = rows.filter(config.missingDescription).length;
    return JSON.stringify({
      evidencePolicy: config.evidencePolicy,
      coverage: {
        total,
        returned: rows.length,
        remaining,
        photosInspected: 0,
        missingDecorativeDescriptions: missing,
        complete: nextCursor === null && remaining === 0,
        scope:
          "Active household records up to throughId; counts are live, not a frozen snapshot. Complete means end of browse, not proof all pages were reviewed.",
      },
      throughId,
      nextCursor,
      items: rows.map((row) =>
        collectionReviewEvidence(
          row,
          config.idKey,
          config.missingDescription(row),
        ),
      ),
    });
  }
  return { payload, tools, browse };
}
