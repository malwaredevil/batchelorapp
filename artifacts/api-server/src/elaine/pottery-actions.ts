import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import type OpenAI from "openai";
import { db, potteryItems, potteryCategories } from "@workspace/db";

// Elaine's write-actions for the Pottery app. Creating a brand-new item isn't
// offered here since every pottery item requires an uploaded photo
// (imagePath is NOT NULL) and chat has no way to attach one — Elaine can
// update/delete existing items and manage categories instead.

export const UpdatePotteryItemActionPayload = z
  .object({
    itemId: z.number().int().positive(),
    name: z.string().min(1).max(200).optional(),
    notes: z.string().max(4000).optional(),
    quantity: z.number().int().min(0).max(9999).optional(),
    style: z.string().max(200).optional(),
    shape: z.string().max(200).optional(),
    maker: z.string().max(200).optional(),
    condition: z.string().max(200).optional(),
    origin: z.string().max(200).optional(),
    approximateEra: z.string().max(200).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.notes !== undefined ||
      v.quantity !== undefined ||
      v.style !== undefined ||
      v.shape !== undefined ||
      v.maker !== undefined ||
      v.condition !== undefined ||
      v.origin !== undefined ||
      v.approximateEra !== undefined,
    { message: "At least one field to update must be provided" },
  );

export const DeletePotteryItemActionPayload = z.object({
  itemId: z.number().int().positive(),
});

export const CreatePotteryCategoryActionPayload = z.object({
  name: z.string().min(1).max(100),
});

export const DeletePotteryCategoryActionPayload = z.object({
  categoryId: z.number().int().positive(),
});

export const potteryActionSchemas = [
  z.object({
    type: z.literal("update_pottery_item"),
    payload: UpdatePotteryItemActionPayload,
  }),
  z.object({
    type: z.literal("delete_pottery_item"),
    payload: DeletePotteryItemActionPayload,
  }),
  z.object({
    type: z.literal("create_pottery_category"),
    payload: CreatePotteryCategoryActionPayload,
  }),
  z.object({
    type: z.literal("delete_pottery_category"),
    payload: DeletePotteryCategoryActionPayload,
  }),
] as const;

export type PotteryActionType =
  | "update_pottery_item"
  | "delete_pottery_item"
  | "create_pottery_category"
  | "delete_pottery_category";

async function getPotteryItemLabelInfo(
  itemId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: potteryItems.name })
    .from(potteryItems)
    .where(eq(potteryItems.id, itemId));
  return row ?? null;
}

async function getPotteryCategoryLabelInfo(
  categoryId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: potteryCategories.name })
    .from(potteryCategories)
    .where(eq(potteryCategories.id, categoryId));
  return row ?? null;
}

type ActionExecutor = (
  payload: never,
  userId: number,
) => Promise<{ status: number; body: unknown }>;

export const potteryActionExecutors: Record<PotteryActionType, ActionExecutor> =
  {
    update_pottery_item: (async (
      payload: z.infer<typeof UpdatePotteryItemActionPayload>,
      userId: number,
    ) => {
      const [existing] = await db
        .select({ id: potteryItems.id })
        .from(potteryItems)
        .where(
          and(
            eq(potteryItems.id, payload.itemId),
            eq(potteryItems.userId, userId),
          ),
        );
      if (!existing) return { status: 404, body: { error: "Item not found" } };

      const updates: Partial<typeof potteryItems.$inferInsert> = {};
      if (payload.name !== undefined) updates.name = payload.name;
      if (payload.notes !== undefined) updates.notes = payload.notes;
      if (payload.quantity !== undefined) updates.quantity = payload.quantity;
      if (payload.style !== undefined) updates.style = payload.style;
      if (payload.shape !== undefined) updates.shape = payload.shape;
      if (payload.maker !== undefined) updates.maker = payload.maker;
      if (payload.condition !== undefined)
        updates.condition = payload.condition;
      if (payload.origin !== undefined) updates.origin = payload.origin;
      if (payload.approximateEra !== undefined)
        updates.approximateEra = payload.approximateEra;

      const [row] = await db
        .update(potteryItems)
        .set(updates)
        .where(eq(potteryItems.id, payload.itemId))
        .returning();
      return {
        status: 200,
        body: { type: "update_pottery_item", result: row },
      };
    }) as ActionExecutor,

    delete_pottery_item: (async (
      payload: z.infer<typeof DeletePotteryItemActionPayload>,
      userId: number,
    ) => {
      const [existing] = await db
        .select({ id: potteryItems.id })
        .from(potteryItems)
        .where(
          and(
            eq(potteryItems.id, payload.itemId),
            eq(potteryItems.userId, userId),
          ),
        );
      if (!existing) return { status: 404, body: { error: "Item not found" } };
      await db.delete(potteryItems).where(eq(potteryItems.id, payload.itemId));
      return {
        status: 200,
        body: { type: "delete_pottery_item", result: { id: payload.itemId } },
      };
    }) as ActionExecutor,

    create_pottery_category: (async (
      payload: z.infer<typeof CreatePotteryCategoryActionPayload>,
      userId: number,
    ) => {
      const [row] = await db
        .insert(potteryCategories)
        .values({ name: payload.name, userId })
        .returning();
      return {
        status: 201,
        body: { type: "create_pottery_category", result: row },
      };
    }) as ActionExecutor,

    delete_pottery_category: (async (
      payload: z.infer<typeof DeletePotteryCategoryActionPayload>,
      userId: number,
    ) => {
      const [existing] = await db
        .select({ id: potteryCategories.id })
        .from(potteryCategories)
        .where(
          and(
            eq(potteryCategories.id, payload.categoryId),
            eq(potteryCategories.userId, userId),
          ),
        );
      if (!existing)
        return { status: 404, body: { error: "Category not found" } };
      await db
        .delete(potteryCategories)
        .where(eq(potteryCategories.id, payload.categoryId));
      return {
        status: 200,
        body: {
          type: "delete_pottery_category",
          result: { id: payload.categoryId },
        },
      };
    }) as ActionExecutor,
  };

export async function buildPotteryActionLabel(action: {
  type: PotteryActionType;
  payload: unknown;
}): Promise<string> {
  switch (action.type) {
    case "update_pottery_item": {
      const payload = action.payload as z.infer<
        typeof UpdatePotteryItemActionPayload
      >;
      const item = await getPotteryItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this item";
      return `Update ${name} in your pottery collection`;
    }
    case "delete_pottery_item": {
      const payload = action.payload as z.infer<
        typeof DeletePotteryItemActionPayload
      >;
      const item = await getPotteryItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this item";
      return `Delete ${name} from your pottery collection`;
    }
    case "create_pottery_category": {
      const payload = action.payload as z.infer<
        typeof CreatePotteryCategoryActionPayload
      >;
      return `Create the pottery category "${payload.name}"`;
    }
    case "delete_pottery_category": {
      const payload = action.payload as z.infer<
        typeof DeletePotteryCategoryActionPayload
      >;
      const cat = await getPotteryCategoryLabelInfo(payload.categoryId);
      const name = cat ? `"${cat.name}"` : "this category";
      return `Delete the pottery category ${name}`;
    }
  }
}

export const potteryActionTools: OpenAI.Chat.Completions.ChatCompletionTool[] =
  [
    {
      type: "function",
      function: {
        name: "update_pottery_item",
        description:
          'Propose editing an EXISTING pottery item in the user\'s collection, e.g. "rename that piece" or "note that it has a chip". Only call this if the item\'s numeric id is visible on screen (look for "itemId: <number>"); never guess an id. Include only the field(s) that actually change.',
        parameters: {
          type: "object",
          properties: {
            itemId: { type: "integer" },
            name: { type: "string" },
            notes: { type: "string" },
            quantity: { type: "integer" },
            style: { type: "string" },
            shape: { type: "string" },
            maker: { type: "string" },
            condition: { type: "string" },
            origin: { type: "string" },
            approximateEra: { type: "string" },
          },
          required: ["itemId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_pottery_item",
        description:
          "Propose permanently deleting a pottery item and its photo(s). Only call this if the item's numeric id is visible on screen; never guess an id. Since this is destructive, say clearly in your visible reply that this will DELETE the item.",
        parameters: {
          type: "object",
          properties: { itemId: { type: "integer" } },
          required: ["itemId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_pottery_category",
        description:
          'Propose creating a new pottery category to organize the collection, e.g. "add a Stoneware category".',
        parameters: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_pottery_category",
        description:
          "Propose permanently deleting a pottery category. Only call this if the category's numeric id is visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: { categoryId: { type: "integer" } },
          required: ["categoryId"],
        },
      },
    },
  ];
