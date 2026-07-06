import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import type OpenAI from "openai";
import {
  db,
  fabrics,
  quiltPatterns,
  shoppingItems,
  quiltingCategories,
} from "@workspace/db";

// Elaine's write-actions for the Quilting app. Creating a brand-new fabric
// isn't offered here since fabrics require an uploaded photo (imagePath is
// NOT NULL) and chat has no way to attach one — Elaine can update/delete
// existing fabrics/patterns and fully manage the shopping list and
// categories instead, since those don't require an image.

export const UpdateFabricActionPayload = z
  .object({
    fabricId: z.number().int().positive(),
    name: z.string().min(1).max(200).optional(),
    notes: z.string().max(4000).optional(),
    colorway: z.string().max(200).optional(),
    printType: z.string().max(200).optional(),
    quantity: z.number().min(0).max(9999).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.notes !== undefined ||
      v.colorway !== undefined ||
      v.printType !== undefined ||
      v.quantity !== undefined,
    { message: "At least one field to update must be provided" },
  );

export const DeleteFabricActionPayload = z.object({
  fabricId: z.number().int().positive(),
});

export const UpdatePatternActionPayload = z
  .object({
    patternId: z.number().int().positive(),
    name: z.string().min(1).max(200).optional(),
    designer: z.string().max(200).optional(),
    notes: z.string().max(4000).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined || v.designer !== undefined || v.notes !== undefined,
    { message: "At least one field to update must be provided" },
  );

export const DeletePatternActionPayload = z.object({
  patternId: z.number().int().positive(),
});

export const CreateShoppingItemActionPayload = z.object({
  name: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  url: z.string().max(1000).optional(),
  quantity: z.number().min(0).max(9999).optional(),
  unit: z.string().max(50).optional(),
  estimatedPriceUsd: z.number().min(0).optional(),
  store: z.string().max(200).optional(),
});

export const UpdateShoppingItemActionPayload = z
  .object({
    shoppingItemId: z.number().int().positive(),
    name: z.string().min(1).max(200).optional(),
    notes: z.string().max(2000).optional(),
    quantity: z.number().min(0).max(9999).optional(),
    status: z.enum(["want", "bought"]).optional(),
    actualPriceUsd: z.number().min(0).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.notes !== undefined ||
      v.quantity !== undefined ||
      v.status !== undefined ||
      v.actualPriceUsd !== undefined,
    { message: "At least one field to update must be provided" },
  );

export const DeleteShoppingItemActionPayload = z.object({
  shoppingItemId: z.number().int().positive(),
});

export const CreateQuiltingCategoryActionPayload = z.object({
  name: z.string().min(1).max(100),
});

export const DeleteQuiltingCategoryActionPayload = z.object({
  categoryId: z.number().int().positive(),
});

export const quiltingActionSchemas = [
  z.object({
    type: z.literal("update_fabric"),
    payload: UpdateFabricActionPayload,
  }),
  z.object({
    type: z.literal("delete_fabric"),
    payload: DeleteFabricActionPayload,
  }),
  z.object({
    type: z.literal("update_pattern"),
    payload: UpdatePatternActionPayload,
  }),
  z.object({
    type: z.literal("delete_pattern"),
    payload: DeletePatternActionPayload,
  }),
  z.object({
    type: z.literal("create_shopping_item"),
    payload: CreateShoppingItemActionPayload,
  }),
  z.object({
    type: z.literal("update_shopping_item"),
    payload: UpdateShoppingItemActionPayload,
  }),
  z.object({
    type: z.literal("delete_shopping_item"),
    payload: DeleteShoppingItemActionPayload,
  }),
  z.object({
    type: z.literal("create_quilting_category"),
    payload: CreateQuiltingCategoryActionPayload,
  }),
  z.object({
    type: z.literal("delete_quilting_category"),
    payload: DeleteQuiltingCategoryActionPayload,
  }),
] as const;

export type QuiltingActionType =
  | "update_fabric"
  | "delete_fabric"
  | "update_pattern"
  | "delete_pattern"
  | "create_shopping_item"
  | "update_shopping_item"
  | "delete_shopping_item"
  | "create_quilting_category"
  | "delete_quilting_category";

async function getFabricLabelInfo(
  fabricId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: fabrics.name })
    .from(fabrics)
    .where(eq(fabrics.id, fabricId));
  return row ?? null;
}

async function getPatternLabelInfo(
  patternId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: quiltPatterns.name })
    .from(quiltPatterns)
    .where(eq(quiltPatterns.id, patternId));
  return row ?? null;
}

async function getShoppingItemLabelInfo(
  shoppingItemId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: shoppingItems.name })
    .from(shoppingItems)
    .where(eq(shoppingItems.id, shoppingItemId));
  return row ?? null;
}

async function getQuiltingCategoryLabelInfo(
  categoryId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: quiltingCategories.name })
    .from(quiltingCategories)
    .where(eq(quiltingCategories.id, categoryId));
  return row ?? null;
}

type ActionExecutor = (
  payload: never,
  userId: number,
) => Promise<{ status: number; body: unknown }>;

export const quiltingActionExecutors: Record<
  QuiltingActionType,
  ActionExecutor
> = {
  update_fabric: (async (
    payload: z.infer<typeof UpdateFabricActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: fabrics.id })
      .from(fabrics)
      .where(and(eq(fabrics.id, payload.fabricId), eq(fabrics.userId, userId)));
    if (!existing) return { status: 404, body: { error: "Fabric not found" } };

    const updates: Partial<typeof fabrics.$inferInsert> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.notes !== undefined) updates.notes = payload.notes;
    if (payload.colorway !== undefined) updates.colorway = payload.colorway;
    if (payload.printType !== undefined) updates.printType = payload.printType;
    if (payload.quantity !== undefined) updates.quantity = payload.quantity;

    const [row] = await db
      .update(fabrics)
      .set(updates)
      .where(eq(fabrics.id, payload.fabricId))
      .returning();
    return { status: 200, body: { type: "update_fabric", result: row } };
  }) as ActionExecutor,

  delete_fabric: (async (
    payload: z.infer<typeof DeleteFabricActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: fabrics.id })
      .from(fabrics)
      .where(and(eq(fabrics.id, payload.fabricId), eq(fabrics.userId, userId)));
    if (!existing) return { status: 404, body: { error: "Fabric not found" } };
    await db.delete(fabrics).where(eq(fabrics.id, payload.fabricId));
    return {
      status: 200,
      body: { type: "delete_fabric", result: { id: payload.fabricId } },
    };
  }) as ActionExecutor,

  update_pattern: (async (
    payload: z.infer<typeof UpdatePatternActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: quiltPatterns.id })
      .from(quiltPatterns)
      .where(
        and(
          eq(quiltPatterns.id, payload.patternId),
          eq(quiltPatterns.userId, userId),
        ),
      );
    if (!existing) return { status: 404, body: { error: "Pattern not found" } };

    const updates: Partial<typeof quiltPatterns.$inferInsert> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.designer !== undefined) updates.designer = payload.designer;
    if (payload.notes !== undefined) updates.notes = payload.notes;

    const [row] = await db
      .update(quiltPatterns)
      .set(updates)
      .where(eq(quiltPatterns.id, payload.patternId))
      .returning();
    return { status: 200, body: { type: "update_pattern", result: row } };
  }) as ActionExecutor,

  delete_pattern: (async (
    payload: z.infer<typeof DeletePatternActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: quiltPatterns.id })
      .from(quiltPatterns)
      .where(
        and(
          eq(quiltPatterns.id, payload.patternId),
          eq(quiltPatterns.userId, userId),
        ),
      );
    if (!existing) return { status: 404, body: { error: "Pattern not found" } };
    await db
      .delete(quiltPatterns)
      .where(eq(quiltPatterns.id, payload.patternId));
    return {
      status: 200,
      body: { type: "delete_pattern", result: { id: payload.patternId } },
    };
  }) as ActionExecutor,

  create_shopping_item: (async (
    payload: z.infer<typeof CreateShoppingItemActionPayload>,
    userId: number,
  ) => {
    const [row] = await db
      .insert(shoppingItems)
      .values({
        userId,
        name: payload.name,
        notes: payload.notes,
        url: payload.url,
        quantity: payload.quantity,
        unit: payload.unit ?? "yards",
        estimatedPriceUsd: payload.estimatedPriceUsd,
        store: payload.store,
      })
      .returning();
    return { status: 201, body: { type: "create_shopping_item", result: row } };
  }) as ActionExecutor,

  update_shopping_item: (async (
    payload: z.infer<typeof UpdateShoppingItemActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: shoppingItems.id })
      .from(shoppingItems)
      .where(
        and(
          eq(shoppingItems.id, payload.shoppingItemId),
          eq(shoppingItems.userId, userId),
        ),
      );
    if (!existing)
      return { status: 404, body: { error: "Shopping item not found" } };

    const updates: Partial<typeof shoppingItems.$inferInsert> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.notes !== undefined) updates.notes = payload.notes;
    if (payload.quantity !== undefined) updates.quantity = payload.quantity;
    if (payload.status !== undefined) updates.status = payload.status;
    if (payload.actualPriceUsd !== undefined)
      updates.actualPriceUsd = payload.actualPriceUsd;

    const [row] = await db
      .update(shoppingItems)
      .set(updates)
      .where(eq(shoppingItems.id, payload.shoppingItemId))
      .returning();
    return { status: 200, body: { type: "update_shopping_item", result: row } };
  }) as ActionExecutor,

  delete_shopping_item: (async (
    payload: z.infer<typeof DeleteShoppingItemActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: shoppingItems.id })
      .from(shoppingItems)
      .where(
        and(
          eq(shoppingItems.id, payload.shoppingItemId),
          eq(shoppingItems.userId, userId),
        ),
      );
    if (!existing)
      return { status: 404, body: { error: "Shopping item not found" } };
    await db
      .delete(shoppingItems)
      .where(eq(shoppingItems.id, payload.shoppingItemId));
    return {
      status: 200,
      body: {
        type: "delete_shopping_item",
        result: { id: payload.shoppingItemId },
      },
    };
  }) as ActionExecutor,

  create_quilting_category: (async (
    payload: z.infer<typeof CreateQuiltingCategoryActionPayload>,
    userId: number,
  ) => {
    const [row] = await db
      .insert(quiltingCategories)
      .values({ name: payload.name, userId })
      .returning();
    return {
      status: 201,
      body: { type: "create_quilting_category", result: row },
    };
  }) as ActionExecutor,

  delete_quilting_category: (async (
    payload: z.infer<typeof DeleteQuiltingCategoryActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: quiltingCategories.id })
      .from(quiltingCategories)
      .where(
        and(
          eq(quiltingCategories.id, payload.categoryId),
          eq(quiltingCategories.userId, userId),
        ),
      );
    if (!existing)
      return { status: 404, body: { error: "Category not found" } };
    await db
      .delete(quiltingCategories)
      .where(eq(quiltingCategories.id, payload.categoryId));
    return {
      status: 200,
      body: {
        type: "delete_quilting_category",
        result: { id: payload.categoryId },
      },
    };
  }) as ActionExecutor,
};

export async function buildQuiltingActionLabel(action: {
  type: QuiltingActionType;
  payload: unknown;
}): Promise<string> {
  switch (action.type) {
    case "update_fabric": {
      const payload = action.payload as z.infer<
        typeof UpdateFabricActionPayload
      >;
      const fabric = await getFabricLabelInfo(payload.fabricId);
      const name = fabric ? `"${fabric.name}"` : "this fabric";
      return `Update ${name} in your fabric stash`;
    }
    case "delete_fabric": {
      const payload = action.payload as z.infer<
        typeof DeleteFabricActionPayload
      >;
      const fabric = await getFabricLabelInfo(payload.fabricId);
      const name = fabric ? `"${fabric.name}"` : "this fabric";
      return `Delete ${name} from your fabric stash`;
    }
    case "update_pattern": {
      const payload = action.payload as z.infer<
        typeof UpdatePatternActionPayload
      >;
      const pattern = await getPatternLabelInfo(payload.patternId);
      const name = pattern ? `"${pattern.name}"` : "this pattern";
      return `Update ${name}`;
    }
    case "delete_pattern": {
      const payload = action.payload as z.infer<
        typeof DeletePatternActionPayload
      >;
      const pattern = await getPatternLabelInfo(payload.patternId);
      const name = pattern ? `"${pattern.name}"` : "this pattern";
      return `Delete ${name}`;
    }
    case "create_shopping_item": {
      const payload = action.payload as z.infer<
        typeof CreateShoppingItemActionPayload
      >;
      return `Add "${payload.name}" to your quilting shopping list`;
    }
    case "update_shopping_item": {
      const payload = action.payload as z.infer<
        typeof UpdateShoppingItemActionPayload
      >;
      const item = await getShoppingItemLabelInfo(payload.shoppingItemId);
      const name = item ? `"${item.name}"` : "this shopping item";
      return payload.status === "bought"
        ? `Mark ${name} as bought`
        : `Update ${name} on your shopping list`;
    }
    case "delete_shopping_item": {
      const payload = action.payload as z.infer<
        typeof DeleteShoppingItemActionPayload
      >;
      const item = await getShoppingItemLabelInfo(payload.shoppingItemId);
      const name = item ? `"${item.name}"` : "this shopping item";
      return `Remove ${name} from your shopping list`;
    }
    case "create_quilting_category": {
      const payload = action.payload as z.infer<
        typeof CreateQuiltingCategoryActionPayload
      >;
      return `Create the quilting category "${payload.name}"`;
    }
    case "delete_quilting_category": {
      const payload = action.payload as z.infer<
        typeof DeleteQuiltingCategoryActionPayload
      >;
      const cat = await getQuiltingCategoryLabelInfo(payload.categoryId);
      const name = cat ? `"${cat.name}"` : "this category";
      return `Delete the quilting category ${name}`;
    }
  }
}

export const quiltingActionTools: OpenAI.Chat.Completions.ChatCompletionTool[] =
  [
    {
      type: "function",
      function: {
        name: "update_fabric",
        description:
          'Propose editing an EXISTING fabric in the user\'s stash, e.g. "note that I only have half a yard left". Only call this if the fabric\'s numeric id is visible on screen (look for "fabricId: <number>"); never guess an id. Include only the field(s) that actually change.',
        parameters: {
          type: "object",
          properties: {
            fabricId: { type: "integer" },
            name: { type: "string" },
            notes: { type: "string" },
            colorway: { type: "string" },
            printType: { type: "string" },
            quantity: { type: "number" },
          },
          required: ["fabricId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_fabric",
        description:
          "Propose permanently deleting a fabric and its photo(s). Only call this if the fabric's numeric id is visible on screen; never guess an id. Since this is destructive, say clearly in your visible reply that this will DELETE the fabric.",
        parameters: {
          type: "object",
          properties: { fabricId: { type: "integer" } },
          required: ["fabricId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_pattern",
        description:
          "Propose editing an EXISTING quilt pattern's name, designer, or notes. Only call this if the pattern's numeric id is visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: {
            patternId: { type: "integer" },
            name: { type: "string" },
            designer: { type: "string" },
            notes: { type: "string" },
          },
          required: ["patternId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_pattern",
        description:
          "Propose permanently deleting a quilt pattern. Only call this if the pattern's numeric id is visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: { patternId: { type: "integer" } },
          required: ["patternId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_shopping_item",
        description:
          'Propose adding an item to the quilting shopping list, e.g. "add 2 yards of navy solid to my shopping list".',
        parameters: {
          type: "object",
          properties: {
            name: { type: "string" },
            notes: { type: "string" },
            url: { type: "string" },
            quantity: { type: "number" },
            unit: {
              type: "string",
              description: 'e.g. "yards", "fat quarters"',
            },
            estimatedPriceUsd: { type: "number" },
            store: { type: "string" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_shopping_item",
        description:
          'Propose updating a shopping list item, e.g. "mark that as bought" or "update the price". Only call this if the item\'s numeric id is visible on screen; never guess an id.',
        parameters: {
          type: "object",
          properties: {
            shoppingItemId: { type: "integer" },
            name: { type: "string" },
            notes: { type: "string" },
            quantity: { type: "number" },
            status: { type: "string", enum: ["want", "bought"] },
            actualPriceUsd: { type: "number" },
          },
          required: ["shoppingItemId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_shopping_item",
        description:
          "Propose removing an item from the shopping list. Only call this if the item's numeric id is visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: { shoppingItemId: { type: "integer" } },
          required: ["shoppingItemId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_quilting_category",
        description: "Propose creating a new quilting category.",
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
        name: "delete_quilting_category",
        description:
          "Propose permanently deleting a quilting category. Only call this if the category's numeric id is visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: { categoryId: { type: "integer" } },
          required: ["categoryId"],
        },
      },
    },
  ];
