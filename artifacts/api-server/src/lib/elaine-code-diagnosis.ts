import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  elaineCodeSuggestions,
  elaineCodeTasks,
  type ElaineCodeSuggestionRow,
  type ElaineCodeTaskRow,
} from "@workspace/db";
import { callModel, getModels, getThresholds } from "./ai-client";
import { logger } from "./logger";

/**
 * Code-grounded diagnosis for recurring self-heal failures (#895).
 *
 * elaine_lessons already gives Elaine BEHAVIORAL memory ("I should ask
 * before assuming X") — that's prompt-level and never looks at real code.
 * When the *same* tagged failure pattern recurs often enough
 * (occurrenceCount crosses thresholds.codeDiagnosisRecurrenceThreshold),
 * the real cause is often a gap in the code itself, not something a better
 * prompt can fix. This module gives Elaine a narrow, read-only,
 * secret-excluding look at the specific source file(s) tied to that
 * pattern, and — only if a *concrete, code-grounded* hypothesis emerges —
 * persists a suggestion row for a human to accept or dismiss in the Owner
 * Panel. Elaine never edits, tests, or ships code herself, and this is
 * never reachable as a chat-callable tool (from any channel, restricted or
 * not) — it only runs from this internal hook.
 */

// ---------------------------------------------------------------------------
// File allowlist — explicit, narrow, per pattern key. Literal relative paths
// only (never globs/directories), so there is no path-resolution surface for
// an unexpected file to slip through. Add new patterns here deliberately.
// ---------------------------------------------------------------------------

export const CODE_DIAGNOSIS_FILE_ALLOWLIST: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  // --- Self-heal patterns (server detects an ungrounded claim in Elaine's reply) ---
  "self_heal:claimed_check_without_tool_call": [
    "artifacts/api-server/src/elaine/runtime/self-heal-policy.ts",
    "artifacts/api-server/src/lib/elaine-lessons.ts",
  ],
  "self_heal:claimed_action_outcome_without_tool_call": [
    "artifacts/api-server/src/elaine/runtime/self-heal-policy.ts",
    "artifacts/api-server/src/lib/elaine-lessons.ts",
  ],
  // --- Explicit-assistant patterns (#920) ---
  // Elaine records these herself via the record_lesson tool. A recurring
  // explicit lesson with the same canonical tag set is as strong a signal as
  // a server-detected self-heal: the model keeps making the same mistake even
  // after writing a lesson about it, which suggests a code gap (missing tool
  // guard, incomplete prompt section, or a logic branch that never grounds the
  // claim) rather than a simple one-off phrasing issue.
  //
  // scheduling + ungrounded: Elaine reports a scheduled action as confirmed
  // without a real tool call verifying the outcome. The grounding check lives
  // in self-heal-policy.ts; the scheduling action logic lives in
  // reminder-actions.ts. Both are scoped narrowly — scheduler grounding is
  // self-contained and doesn't require reading all of index.ts.
  "explicit_assistant:scheduling+ungrounded": [
    "artifacts/api-server/src/elaine/runtime/self-heal-policy.ts",
    "artifacts/api-server/src/elaine/reminder-actions.ts",
  ],
  // reminders + timing: Elaine gets the scheduling time wrong (wrong timezone,
  // ambiguous relative-time interpretation, or off-by-one day). The timing
  // logic is entirely within reminder-actions.ts.
  "explicit_assistant:reminders+timing": [
    "artifacts/api-server/src/elaine/reminder-actions.ts",
  ],
  // --- Classifier-doubt patterns (#915) ---
  // Server detects the user expressing doubt about whether a previous action
  // actually completed. When these recur, the root cause is likely a gap in
  // the detector regex (SCHEDULING_DOUBT_RE / REMINDER_DOUBT_RE) or in how
  // the forced tool call grounds Elaine's follow-up reply — both live in
  // classifier.ts. Deliberately scoped to that one file (not the full runtime
  // index) because the doubt-detection logic is self-contained there and
  // reading index.ts would expose far too broad a surface.
  "classifier_doubt:scheduling": [
    "artifacts/api-server/src/elaine/runtime/classifier.ts",
  ],
  "classifier_doubt:reminder": [
    "artifacts/api-server/src/elaine/runtime/classifier.ts",
  ],
});

// Defense-in-depth #1: every allowlisted path must live under one of these
// prefixes, even though the list above is already literal. Catches a future
// careless addition (e.g. someone pasting a path outside Elaine's own code)
// before it can ever be read.
const ALLOWED_PATH_PREFIXES = [
  "artifacts/api-server/src/elaine/",
  "artifacts/api-server/src/lib/",
];

// Defense-in-depth #2: hard-reject anything that could conceivably be a
// secrets/credentials file by name, regardless of the allowlist above.
const FORBIDDEN_PATH_RE =
  /(^|\/)\.env(\..*)?$|secret|credential|\.pem$|\.key$|\.p12$|\.pfx$/i;

// Defense-in-depth #3: reject file *content* that looks like a live
// credential, so a suggestion can never quote secret material even if a
// future allowlist entry were misconfigured. Deliberately duplicated (not
// imported) from scripts/src/check-public-file-secrets.ts's PATTERNS —
// scripts isn't a runtime dependency of api-server, and this only needs the
// small subset relevant to source files (not the doc-only/env-var-literal
// checks, which need process.env access this tool has no business doing).
// Keep this list in sync if check-public-file-secrets.ts adds new formats.
const CONTENT_SECRET_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{100,}/, // JWT (Supabase anon/service key, OAuth token)
  /\bsk-(?:or-|proj-)?[A-Za-z0-9]{20,}\b/, // OpenAI / OpenRouter key
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/, // GitHub PAT
  /\bgithub_pat_[A-Za-z0-9_]{82,}\b/, // GitHub fine-grained PAT
  /\bAIza[A-Za-z0-9_-]{35,}\b/, // Google API key
  /\bxox[bpoa]-[0-9A-Za-z-]{10,}\b/, // Slack token
  /\bre_[A-Za-z0-9]{24,}\b/, // Resend key
  // Google OAuth client ID. Anchored on both sides against any adjacent
  // domain-like character so a crafted longer host (e.g. a client-id-shaped
  // prefix glued onto an unrelated domain) can't slip past this check.
  /(?:^|[^\w.-])\d{10,}-[a-z0-9]{32}\.apps\.googleusercontent\.com(?:[^\w.-]|$)/,
];

const MAX_FILE_BYTES = 200 * 1024;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// artifacts/api-server/src/lib -> artifacts/api-server/src -> artifacts/api-server
// -> artifacts -> workspace root
const REPO_ROOT = path.resolve(__dirname, "../../../..");

export class CodeDiagnosisFileError extends Error {}

/**
 * Throws if `relPath` fails any allowlist/exclusion check. Exported (rather
 * than kept private) so tests can exercise the path-safety rules directly,
 * without needing a real file on disk for every case.
 */
export function assertReadable(relPath: string): void {
  if (FORBIDDEN_PATH_RE.test(relPath)) {
    throw new CodeDiagnosisFileError(
      `refusing to read "${relPath}": matches a forbidden secret-like path pattern`,
    );
  }
  if (!ALLOWED_PATH_PREFIXES.some((prefix) => relPath.startsWith(prefix))) {
    throw new CodeDiagnosisFileError(
      `refusing to read "${relPath}": outside the allowed path prefixes`,
    );
  }
}

/**
 * Exported so tests can exercise the secret-content heuristic directly with
 * synthetic fixtures, without needing a real file on disk that contains
 * (fake) secret-shaped content.
 */
export function hasSecretLikeContent(content: string): boolean {
  return CONTENT_SECRET_PATTERNS.some((pattern) => pattern.test(content));
}

export interface ReviewedFile {
  path: string;
  content: string;
}

/**
 * Reads every allowlisted file for `patternKey`, applying every
 * defense-in-depth check before returning content. Returns an empty array
 * (rather than throwing) for an unknown pattern key — diagnosis simply
 * doesn't run for patterns with no configured allowlist. Throws if a
 * configured file fails a safety check or looks like it contains secret
 * material — this must never silently degrade to "just skip that file",
 * since the whole point is the guarantee that a suggestion can never quote
 * secret content.
 */
export function readAllowlistedSourceFiles(patternKey: string): ReviewedFile[] {
  const relPaths = CODE_DIAGNOSIS_FILE_ALLOWLIST[patternKey];
  if (!relPaths || relPaths.length === 0) return [];

  return relPaths.map((relPath) => {
    assertReadable(relPath);
    const absPath = path.resolve(REPO_ROOT, relPath);
    // Belt-and-suspenders: the resolved absolute path must still be inside
    // the repo root (rules out any ../.. escape even from a literal-looking
    // but crafted allowlist entry).
    if (!absPath.startsWith(REPO_ROOT + path.sep)) {
      throw new CodeDiagnosisFileError(
        `refusing to read "${relPath}": resolves outside the repo root`,
      );
    }
    // Read once and size-check the content actually returned, rather than
    // statting then reading — a separate stat-then-read pair leaves a TOCTOU
    // window where the file could change between the two calls.
    const content = fs.readFileSync(absPath, "utf-8");
    if (Buffer.byteLength(content, "utf-8") > MAX_FILE_BYTES) {
      throw new CodeDiagnosisFileError(
        `refusing to read "${relPath}": file too large (${Buffer.byteLength(content, "utf-8")} bytes)`,
      );
    }
    if (hasSecretLikeContent(content)) {
      throw new CodeDiagnosisFileError(
        `refusing to read "${relPath}": content matches a secret-like pattern`,
      );
    }
    return { path: relPath, content };
  });
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

export interface DiagnosisInput {
  patternKey: string;
  lessonId: number;
  occurrenceCount: number;
  situation: string;
  takeaway: string;
}

interface DiagnosisModelResult {
  hasHypothesis: boolean;
  filesReferenced: string[];
  hypothesis: string;
}

function parseDiagnosisJson(raw: string): DiagnosisModelResult | null {
  try {
    const stripped = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    if (typeof parsed.hasHypothesis !== "boolean") return null;
    return {
      hasHypothesis: parsed.hasHypothesis,
      filesReferenced: Array.isArray(parsed.filesReferenced)
        ? parsed.filesReferenced.filter(
            (f): f is string => typeof f === "string",
          )
        : [],
      hypothesis:
        typeof parsed.hypothesis === "string" ? parsed.hypothesis.trim() : "",
    };
  } catch {
    return null;
  }
}

/**
 * Asks a model to form a hypothesis for why `patternKey` keeps recurring,
 * grounded strictly in the allowlisted file contents provided — never in
 * the behavioral lesson alone. Returns null when no concrete, code-grounded
 * hypothesis is warranted (including: no files configured for this pattern,
 * a parse failure, or the model itself declining).
 */
async function diagnoseFromCode(
  input: DiagnosisInput,
  files: ReviewedFile[],
): Promise<DiagnosisModelResult | null> {
  if (files.length === 0) return null;

  const models = await getModels();
  const filesBlock = files
    .map((f) => `--- FILE: ${f.path} ---\n${f.content}`)
    .join("\n\n");

  const raw = await callModel(models.advisor, async (client, model) => {
    const resp = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are Elaine performing an internal, read-only code diagnosis. A behavioral correction (a 'lesson') has recurred several times, which suggests the root cause may be a gap in the code itself rather than something a better prompt can fix. " +
            "You are given the exact source file(s) relevant to this failure pattern. " +
            "Form a hypothesis ONLY if it is concretely grounded in the code shown — cite the specific file and function/region. Do not simply restate the behavioral lesson in different words; that is not a code-grounded hypothesis. " +
            "If you cannot point to a specific, plausible gap in the code shown, set hasHypothesis to false rather than guessing. " +
            "Never suggest exposing, logging, or including any secret, credential, token, or API key. " +
            "Respond with ONLY a JSON object: " +
            '{"hasHypothesis": boolean, "filesReferenced": string[], "hypothesis": string}. ' +
            "filesReferenced must be a subset of the file paths you were given. hypothesis must be plain language a non-engineer reviewer can understand, describing what should change and why.",
        },
        {
          role: "user",
          content: `Recurring failure pattern: ${input.patternKey}\nOccurrences so far: ${input.occurrenceCount}\n\nBehavioral lesson already recorded:\nSituation: ${input.situation}\nTakeaway: ${input.takeaway}\n\nRelevant source file(s):\n\n${filesBlock}`,
        },
      ],
      max_tokens: 1200,
    });
    return resp.choices[0]?.message?.content ?? "";
  });

  const parsed = parseDiagnosisJson(raw);
  if (!parsed || !parsed.hasHypothesis || !parsed.hypothesis) return null;

  // Never trust the model's filesReferenced list beyond what it was actually
  // shown — clamp to the intersection so a suggestion can't claim to have
  // reviewed a file it never saw.
  const shownPaths = new Set(files.map((f) => f.path));
  const filesReferenced = parsed.filesReferenced.filter((f) =>
    shownPaths.has(f),
  );
  // Final content guard on the hypothesis text itself, mirroring the
  // file-content check above — belt-and-suspenders against the model
  // echoing something secret-shaped it shouldn't have generated.
  if (hasSecretLikeContent(parsed.hypothesis)) return null;

  return {
    hasHypothesis: true,
    filesReferenced:
      filesReferenced.length > 0 ? filesReferenced : [...shownPaths],
    hypothesis: parsed.hypothesis,
  };
}

/** True when a 'pending' suggestion already exists for this pattern key. */
async function hasPendingSuggestion(patternKey: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: elaineCodeSuggestions.id })
    .from(elaineCodeSuggestions)
    .where(
      and(
        eq(elaineCodeSuggestions.patternKey, patternKey),
        eq(elaineCodeSuggestions.status, "pending"),
      ),
    )
    .limit(1);
  return !!existing;
}

/**
 * Orchestrates the full recurrence-triggered diagnosis flow. Safe to call
 * on every self-heal lesson write — it no-ops unless every gate passes:
 *   1. occurrenceCount has crossed the configured threshold.
 *   2. No 'pending' suggestion already exists for this pattern (dedup —
 *      never spam a second suggestion while one awaits review).
 *   3. The pattern has a configured file allowlist.
 *   4. A concrete, code-grounded hypothesis actually emerges.
 * Never throws for expected "nothing to do" cases; only genuine
 * infrastructure errors (DB, model call) propagate to the caller, which is
 * expected to treat this as best-effort and never let it fail the user's
 * turn (see the fire-and-forget call site in elaine/index.ts).
 */
export async function maybeDiagnoseRecurringFailure(
  input: DiagnosisInput,
): Promise<ElaineCodeSuggestionRow | null> {
  const thresholds = await getThresholds();
  if (input.occurrenceCount < thresholds.codeDiagnosisRecurrenceThreshold) {
    return null;
  }

  if (await hasPendingSuggestion(input.patternKey)) {
    return null;
  }

  const files = readAllowlistedSourceFiles(input.patternKey);
  if (files.length === 0) return null;

  const diagnosis = await diagnoseFromCode(input, files);
  if (!diagnosis) return null;

  // The partial unique index on (pattern_key) WHERE status = 'pending' is
  // the atomic source of truth for the dedup guarantee above — the
  // select-then-insert check is just an optimization to skip the model
  // call in the common case; a race between two concurrent turns is still
  // safe because of onConflictDoNothing here.
  const [created] = await db
    .insert(elaineCodeSuggestions)
    .values({
      patternKey: input.patternKey,
      lessonId: input.lessonId,
      occurrenceCount: input.occurrenceCount,
      observedPattern: `${input.situation}\n\n${input.takeaway}`,
      filesReviewed: diagnosis.filesReferenced.map((p) => ({ path: p })),
      hypothesis: diagnosis.hypothesis,
      status: "pending",
    })
    .onConflictDoNothing({
      target: elaineCodeSuggestions.patternKey,
      where: sql`status = 'pending'`,
    })
    .returning();

  return created ?? null;
}

/**
 * Fire-and-forget wrapper for the self-heal turn hook — diagnosis involves
 * an extra model call and must never add latency to (or fail) the user's
 * chat turn. Errors are logged, never thrown.
 */
export function diagnoseRecurringFailureInBackground(
  input: DiagnosisInput,
): void {
  maybeDiagnoseRecurringFailure(input).catch((err: unknown) => {
    logger.warn(
      { err, patternKey: input.patternKey },
      "elaine-code-diagnosis: background diagnosis failed",
    );
  });
}

// ---------------------------------------------------------------------------
// Owner review surface — list / accept / dismiss (used by
// routes/admin/elaine-code-suggestions.ts)
// ---------------------------------------------------------------------------

export async function listElaineCodeSuggestions(
  status?: string,
): Promise<ElaineCodeSuggestionRow[]> {
  const query = db.select().from(elaineCodeSuggestions);
  const rows = status
    ? await query
        .where(eq(elaineCodeSuggestions.status, status))
        .orderBy(desc(elaineCodeSuggestions.createdAt))
    : await query.orderBy(desc(elaineCodeSuggestions.createdAt));
  return rows;
}

export async function decideElaineCodeSuggestion(input: {
  id: number;
  decision: "accepted" | "dismissed";
  decidedByUserId: number;
}): Promise<ElaineCodeSuggestionRow | null> {
  const [updated] = await db
    .update(elaineCodeSuggestions)
    .set({
      status: input.decision,
      decidedAt: new Date(),
      decidedByUserId: input.decidedByUserId,
    })
    .where(
      and(
        eq(elaineCodeSuggestions.id, input.id),
        // Idempotency: only a still-pending suggestion can be decided —
        // re-submitting a decision on an already-decided row is a no-op
        // rather than silently overwriting who/when decided it.
        eq(elaineCodeSuggestions.status, "pending"),
      ),
    )
    .returning();
  return updated ?? null;
}

/**
 * Resets a dismissed suggestion back to pending so the owner can act on it.
 * Clears decidedAt / decidedByUserId / linkedTaskRef so the row looks fresh.
 * Returns null if the row doesn't exist or is not in the dismissed state.
 */
export async function reopenElaineCodeSuggestion(
  id: number,
): Promise<ElaineCodeSuggestionRow | null> {
  const [updated] = await db
    .update(elaineCodeSuggestions)
    .set({
      status: "pending",
      decidedAt: null,
      decidedByUserId: null,
      linkedTaskRef: null,
    })
    .where(
      and(
        eq(elaineCodeSuggestions.id, id),
        eq(elaineCodeSuggestions.status, "dismissed"),
      ),
    )
    .returning();
  return updated ?? null;
}

/**
 * Writes a pre-filled plan file for a suggestion so the owner can paste it
 * when creating the corresponding Replit project task. The file is written to
 * `.local/tasks/` under the repo root and the path is returned so the caller
 * can surface it to the owner. Returns null (never throws) if the write fails —
 * this is best-effort; the decision itself has already been persisted.
 */
export function writeSuggestionPlanFile(
  suggestion: ElaineCodeSuggestionRow,
): string | null {
  try {
    const tasksDir = path.resolve(REPO_ROOT, ".local", "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });

    const slug = suggestion.patternKey
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase()
      .replace(/^-+|-+$/g, "");
    const fileName = `elaine-cs-${suggestion.id}-${slug}.md`;
    const filePath = path.join(tasksDir, fileName);

    const filesReviewed = (
      suggestion.filesReviewed as Array<{ path: string }> | null
    )
      ?.map((f) => `- \`${f.path}\``)
      .join("\n");

    const content = [
      `# Fix: ${suggestion.patternKey}`,
      "",
      "## What & Why",
      `Elaine's self-heal correction for \`${suggestion.patternKey}\` has recurred`,
      `${suggestion.occurrenceCount} times, indicating a gap in the code rather than`,
      "a prompt-only fix.",
      "",
      "## Observed pattern",
      suggestion.observedPattern,
      "",
      "## Suggested change",
      suggestion.hypothesis,
      "",
      ...(filesReviewed ? ["## Relevant files", filesReviewed, ""] : []),
      "## Done looks like",
      `- The \`${suggestion.patternKey}\` self-heal correction stops recurring after this fix.`,
      "",
      `_Generated from Elaine suggestion #${suggestion.id} — accepted ${new Date().toISOString().slice(0, 10)}_`,
    ].join("\n");

    fs.writeFileSync(filePath, content, "utf-8");
    // Return relative path from repo root for display
    return path.relative(REPO_ROOT, filePath);
  } catch (err) {
    logger.warn(
      { err, suggestionId: suggestion.id },
      "elaine-code-diagnosis: failed to write plan file — non-fatal",
    );
    return null;
  }
}

/**
 * Stores the project-task reference (e.g. "#920") the owner linked to an
 * accepted suggestion. Only updates already-accepted rows; calling this on a
 * pending or dismissed suggestion is a no-op (returns null).
 */
export async function linkTaskToSuggestion(
  id: number,
  linkedTaskRef: string,
): Promise<ElaineCodeSuggestionRow | null> {
  const [updated] = await db
    .update(elaineCodeSuggestions)
    .set({ linkedTaskRef })
    .where(
      and(
        eq(elaineCodeSuggestions.id, id),
        eq(elaineCodeSuggestions.status, "accepted"),
      ),
    )
    .returning();
  return updated ?? null;
}

/**
 * One-click accept + task creation flow (#913).
 *
 * All three writes run inside a single transaction so no intermediate state
 * can be committed:
 *  1. Accept the pending suggestion (WHERE status='pending' — returns null if
 *     already decided, so a retry naturally 404s rather than double-creating).
 *  2. Insert an `elaine_code_tasks` row pre-filled from the suggestion content.
 *  3. Write the auto-generated "#<task.id>" ref back onto the suggestion row.
 *
 * Returns `{ suggestion, task }` on success, or null when the suggestion
 * doesn't exist or is already decided. A transient DB error rolls the whole
 * transaction back, leaving the suggestion in its original 'pending' state so
 * the owner can safely retry.
 */
export async function createTaskFromSuggestion(input: {
  suggestionId: number;
  userId: number;
}): Promise<{
  suggestion: ElaineCodeSuggestionRow;
  task: ElaineCodeTaskRow;
} | null> {
  return db.transaction(async (tx) => {
    // Step 1: accept — only if still pending; null → caller returns 404
    const [accepted] = await tx
      .update(elaineCodeSuggestions)
      .set({
        status: "accepted",
        decidedAt: new Date(),
        decidedByUserId: input.userId,
      })
      .where(
        and(
          eq(elaineCodeSuggestions.id, input.suggestionId),
          eq(elaineCodeSuggestions.status, "pending"),
        ),
      )
      .returning();

    if (!accepted) return null;

    // Step 2: insert the task record pre-filled from the suggestion
    const filesLine =
      (accepted.filesReviewed as Array<{ path: string }> | null)
        ?.map((f) => f.path)
        .join(", ") ?? "";

    const title = `Fix: ${accepted.patternKey}`;
    const description = [
      `Pattern recurred ${accepted.occurrenceCount}× — likely a code gap, not just a prompt issue.`,
      "",
      "Observed pattern:",
      accepted.observedPattern,
      "",
      "Suggested change:",
      accepted.hypothesis,
      ...(filesLine ? ["", `Files: ${filesLine}`] : []),
    ].join("\n");

    const [task] = await tx
      .insert(elaineCodeTasks)
      .values({
        title,
        description,
        createdFromSuggestionId: accepted.id,
        createdByUserId: input.userId,
      })
      .returning();

    // Step 3: store the auto-generated ref on the suggestion — same transaction
    const linkedTaskRef = `#${task.id}`;
    const [withRef] = await tx
      .update(elaineCodeSuggestions)
      .set({ linkedTaskRef })
      .where(eq(elaineCodeSuggestions.id, accepted.id))
      .returning();

    return { suggestion: withRef ?? accepted, task };
  });
}
