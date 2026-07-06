import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import type OpenAI from "openai";
import { db, travelsCustomDocumentTypes } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { callModelWithAdvisor, getModels } from "../../lib/ai-client";

const router: IRouter = Router();
router.use(requireAuth);

export const AVAILABLE_ICONS = [
  "Plane",
  "Train",
  "Bus",
  "Car",
  "Ship",
  "Anchor",
  "BedDouble",
  "Shield",
  "Globe",
  "Compass",
  "Ticket",
  "UtensilsCrossed",
  "FileText",
  "Receipt",
  "Package",
  "CreditCard",
  "Briefcase",
  "Tag",
  "Building2",
  "MapPin",
  "Camera",
  "Stamp",
  "Leaf",
  "Star",
  "AlertCircle",
] as const;

export const AVAILABLE_COLORS = [
  "blue",
  "violet",
  "teal",
  "orange",
  "green",
  "amber",
  "red",
  "indigo",
  "rose",
  "emerald",
  "sky",
  "slate",
  "pink",
  "cyan",
] as const;

// Custom document types are household-shared metadata (like a taxonomy),
// not per-user data — every household member sees and can define the same
// set of types. Dedupe by typeKey, keeping the most recently created row if
// legacy per-user duplicates exist.
router.get("/document-types", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(travelsCustomDocumentTypes)
      .orderBy(travelsCustomDocumentTypes.createdAt);
    const byKey = new Map<string, (typeof rows)[number]>();
    for (const row of rows) byKey.set(row.typeKey, row);
    res.json([...byKey.values()]);
  } catch (err) {
    req.log.error(err, "list custom document types");
    res.status(500).json({ error: "Failed to list document types" });
  }
});

router.post("/document-types/suggest", async (req, res) => {
  const { typeName, description } = req.body as {
    typeName?: string;
    description?: string;
  };
  if (!typeName?.trim()) {
    res.status(400).json({ error: "typeName is required" });
    return;
  }

  const prompt = `You are helping a traveller define a new custom travel document type in their travel companion app.

Document type name: "${typeName.trim()}"${description?.trim() ? `\nUser description: "${description.trim()}"` : ""}

Respond with:
1. The single best icon name from this list: ${AVAILABLE_ICONS.join(", ")}
2. A color theme from: ${AVAILABLE_COLORS.join(", ")}
3. An ordered list of 3–6 specific data fields a traveller should record for this document type. Use camelCase keys and short human-readable labels.

Return ONLY valid JSON in exactly this shape (no markdown fences, no commentary):
{
  "iconName": "Receipt",
  "colorKey": "amber",
  "fields": [
    { "key": "referenceNumber", "label": "Reference" },
    { "key": "issuedBy", "label": "Issued by" }
  ]
}`;

  try {
    const models = await getModels();
    const raw = await callModelWithAdvisor(
      models.fastVision,
      "Answer precisely and return only valid JSON.",
      async (client, model) => {
        const resp = await (
          client.chat.completions.create as (
            p: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
          ) => Promise<OpenAI.Chat.Completions.ChatCompletion>
        )({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 400,
        });
        return resp.choices[0]?.message?.content ?? "{}";
      },
    );
    const stripped = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    res.json(JSON.parse(stripped));
  } catch (err) {
    req.log.error(err, "suggest document type");
    res.status(500).json({ error: "AI suggestion failed" });
  }
});

router.post("/document-types", async (req, res) => {
  try {
    const userId = req.session.userId!;
    const { typeKey, typeName, description, iconName, colorKey, fields } =
      req.body as {
        typeKey?: string;
        typeName?: string;
        description?: string;
        iconName?: string;
        colorKey?: string;
        fields?: { key: string; label: string }[];
      };

    if (!typeKey?.trim() || !typeName?.trim()) {
      res.status(400).json({ error: "typeKey and typeName are required" });
      return;
    }

    // Household-shared: upsert by typeKey alone (not scoped to the creating
    // user), so any member editing/re-suggesting a type updates the one
    // shared definition instead of creating a per-user copy.
    const [existing] = await db
      .select()
      .from(travelsCustomDocumentTypes)
      .where(eq(travelsCustomDocumentTypes.typeKey, typeKey.trim()));

    const values = {
      typeName: typeName.trim(),
      description: description ?? null,
      iconName: iconName ?? null,
      colorKey: colorKey ?? null,
      fields: fields ?? [],
    };

    const [row] = existing
      ? await db
          .update(travelsCustomDocumentTypes)
          .set(values)
          .where(eq(travelsCustomDocumentTypes.id, existing.id))
          .returning()
      : await db
          .insert(travelsCustomDocumentTypes)
          .values({ userId, typeKey: typeKey.trim(), ...values })
          .returning();

    res.json(row);
  } catch (err) {
    req.log.error(err, "create custom document type");
    res.status(500).json({ error: "Failed to save document type" });
  }
});

export default router;
