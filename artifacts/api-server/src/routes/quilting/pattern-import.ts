import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { aiLimiter } from "../../middleware/rateLimit";
import { logger } from "../../lib/logger";
import { callModel, getModels } from "../../lib/ai-client";
import { getConfig } from "../../lib/app-config";
import {
  fetchPageText,
  isSafeFetchBlockedError,
} from "../../lib/ssrf-safe-fetch";

const router: IRouter = Router();
router.use(requireAuth);

const ImportUrlSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://") || u.startsWith("http://"), {
      message: "URL must be http or https",
    }),
});

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const IMPORT_PROMPT = `You are a quilting expert. Extract quilt pattern information from the following webpage text.

Respond with STRICT JSON only:
{
  "name": "pattern name (required, never null)",
  "designer": "designer or brand name, or null",
  "difficulty": "beginner|intermediate|advanced or null",
  "blockSizeInches": number or null,
  "numPieces": integer or null,
  "style": "e.g. Log Cabin, Flying Geese, HST, etc. or null",
  "notes": "any other useful info (max 200 chars) or null"
}

If you cannot find a pattern name, use the page title or domain as the name. Never return anything outside the JSON object.`;

router.post("/patterns/import-url", aiLimiter, async (req, res) => {
  const { url } = ImportUrlSchema.parse(req.body);

  let pageText: string;
  try {
    pageText = await fetchPageText(url, {
      userAgent:
        "Mozilla/5.0 (compatible; QuiltingApp/1.0; +https://quilting.batchelor.app)",
    });
  } catch (err) {
    req.log.warn({ err, url }, "Failed to fetch pattern URL");
    res.status(422).json({
      error: isSafeFetchBlockedError(err)
        ? "That URL is not allowed."
        : "Could not fetch that URL. Check it is publicly accessible.",
    });
    return;
  }

  if (!pageText || pageText.length < 20) {
    res.status(422).json({ error: "Page had no readable content." });
    return;
  }

  const models = await getModels();
  const patternImportMaxTokens = await getConfig(
    "quilting",
    "pattern_import_max_tokens",
    400,
  );
  const completion = await callModel(models.fastVision, (client, model) =>
    client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: IMPORT_PROMPT },
        { role: "user", content: `URL: ${url}\n\nPage text:\n${pageText}` },
      ],
      temperature: 0,
      max_tokens: patternImportMaxTokens,
      response_format: { type: "json_object" },
    }),
  );

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ raw }, "Failed to parse pattern import AI response");
    res
      .status(422)
      .json({ error: "Could not extract pattern info from this page." });
    return;
  }

  const name =
    typeof parsed.name === "string" && parsed.name.trim()
      ? parsed.name.trim()
      : null;
  if (!name) {
    res
      .status(422)
      .json({ error: "Could not determine a pattern name from this page." });
    return;
  }

  function asStr(v: unknown) {
    return typeof v === "string" && v.trim() ? v.trim() : null;
  }
  function asNum(v: unknown) {
    return typeof v === "number" && isFinite(v) ? v : null;
  }

  res.json({
    name,
    designer: asStr(parsed.designer),
    difficulty: ["beginner", "intermediate", "advanced"].includes(
      parsed.difficulty as string,
    )
      ? (parsed.difficulty as string)
      : null,
    blockSizeInches: asNum(parsed.blockSizeInches),
    numPieces:
      typeof parsed.numPieces === "number"
        ? Math.round(parsed.numPieces)
        : null,
    style: asStr(parsed.style),
    notes: asStr(parsed.notes),
  });
});

export default router;
