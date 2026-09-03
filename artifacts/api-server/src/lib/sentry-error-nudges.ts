/**
 * Proactive Elaine nudges for new Sentry production errors.
 *
 * Periodically lists unresolved production issues from the Sentry API and
 * announces genuinely NEW issues to the owner via the existing elaine_nudges
 * mechanism (so they appear as Elaine messages in the chat widget).
 *
 * De-duplication (DB-persisted in `sentry_seen_issues`, one row per issue id):
 *   • An issue is announced at most once — after that its row keeps it quiet.
 *   • If Sentry later reports the issue as resolved (is:resolved query), the
 *     row's last_status flips to "resolved". Should the issue then REAPPEAR
 *     in the unresolved list, it has reopened and is announced once more.
 *   • An issue that merely falls out of the stats window (absent from both
 *     lists) is NOT treated as resolved — no re-announcement on return.
 *
 * Consolidation: when several new issues appear in one run they are folded
 * into a single summary nudge instead of a burst of messages.
 *
 * Optional AI suggestion: each announced issue may carry a short, clearly
 * labelled "possible fix" suggestion generated from title/culprit. Suggestion
 * failure is logged and skipped — it never blocks the alert.
 *
 * Not-configured handling: when SENTRY_AUTH_TOKEN / SENTRY_ORG_SLUG /
 * SENTRY_PROJECT_SLUG are missing the run logs once at info level and exits
 * cleanly — no errors, no nudges.
 */

import { pool, db, appUsers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  shouldRunScheduledTask,
  recordScheduledTaskSuccess,
  recordScheduledTaskFailure,
} from "./scheduler-guard";
import {
  listSentryIssues,
  isSentryIssuesConfigured,
  type SentryIssue,
} from "./sentry-issues";
import { callModel, getModels } from "./ai-client";
import { withRetry } from "./retry";

export const SENTRY_NUDGE_TASK_NAME = "sentry-error-nudges";
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const STARTUP_DELAY_MS = 2 * 60 * 1000; // let the server settle first

// Resolved rows older than this are pruned on each run. Re-announcing a truly
// ancient reopened issue after cleanup is acceptable per the task spec.
export const RESOLVED_RETENTION_DAYS = 90;

// At most this many issues get individual detail lines in a consolidated
// message; beyond that the remainder is summarised as a count.
const MAX_DETAILED_ISSUES = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveOwnerId(): Promise<number | null> {
  const ownerRows = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.isOwner, true))
    .limit(1);
  if (ownerRows.length === 0) {
    logger.info("sentry-error-nudges: no owner account found, skipping");
    return null;
  }
  return ownerRows[0]!.id;
}

/** Today as YYYY-MM-DD (UTC) for nudge keys. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function describeIssue(issue: SentryIssue): string {
  const times = issue.count === 1 ? "1 time" : `${issue.count} times`;
  const culprit = issue.culprit ? ` (in ${issue.culprit})` : "";
  return `“${issue.title}”${culprit} — occurred ${times}`;
}

/**
 * Generate a short "possible fix" suggestion for one issue. Returns null on
 * any failure — the caller treats the suggestion as strictly optional.
 * Exported for tests.
 */
export async function generateFixSuggestion(
  issue: SentryIssue,
): Promise<string | null> {
  try {
    const models = await getModels();
    const completion = await callModel(models.subagentWorker, (client, m) =>
      client.chat.completions.create({
        model: m,
        max_tokens: 200,
        messages: [
          {
            role: "system",
            content:
              "You suggest one brief, plausible cause-and-fix idea for a production error, based only on its title and code location. 1-2 sentences, no preamble, no markdown. If you cannot say anything useful, reply with exactly: NONE",
          },
          {
            role: "user",
            content: `Error title: ${issue.title}\nLevel: ${issue.level}\nLocation (culprit): ${issue.culprit || "unknown"}`,
          },
        ],
      }),
    );
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text || text === "NONE") return null;
    return text;
  } catch (err) {
    logger.warn(
      { err, issueId: issue.id },
      "sentry-error-nudges: fix-suggestion generation failed (non-blocking)",
    );
    return null;
  }
}

/**
 * Build the owner-facing nudge message for one run's worth of new issues.
 * Exported for tests.
 */
export function buildNudgeMessage(
  newIssues: { issue: SentryIssue; suggestion: string | null }[],
): string {
  if (newIssues.length === 1) {
    const { issue, suggestion } = newIssues[0]!;
    let msg = `🚨 New production error in Sentry: ${describeIssue(issue)}. First seen ${issue.firstSeen}, last seen ${issue.lastSeen}. View it in the Owner Panel or on sentry.io.`;
    if (suggestion) {
      msg += `\n\nPossible fix (unverified AI suggestion, not a diagnosis): ${suggestion}`;
    }
    return msg;
  }

  const lines = newIssues
    .slice(0, MAX_DETAILED_ISSUES)
    .map(({ issue, suggestion }) => {
      let line = `• ${describeIssue(issue)}`;
      if (suggestion) {
        line += `\n  Possible fix (unverified AI suggestion): ${suggestion}`;
      }
      return line;
    });
  const extra = newIssues.length - MAX_DETAILED_ISSUES;
  if (extra > 0) {
    lines.push(`• …and ${extra} more new issue${extra === 1 ? "" : "s"}.`);
  }
  return `🚨 ${newIssues.length} new production errors appeared in Sentry:\n${lines.join("\n")}\nSee the Owner Panel or sentry.io for details.`;
}

// ---------------------------------------------------------------------------
// Core run
// ---------------------------------------------------------------------------

/**
 * One full check-and-nudge pass. Safe to call from both the in-process
 * scheduler and a one-shot cron process — all state lives in the DB.
 */
export async function computeAndStoreSentryErrorNudges(): Promise<void> {
  if (!isSentryIssuesConfigured()) {
    logger.info(
      "sentry-error-nudges: Sentry API not configured (SENTRY_AUTH_TOKEN/SENTRY_ORG_SLUG/SENTRY_PROJECT_SLUG) — skipping",
    );
    return;
  }

  const client = await pool.connect().catch((err: unknown) => {
    logger.warn({ err }, "sentry-error-nudges: could not connect to DB");
    // The scheduler wraps the full pass in withRetry(). Do not turn a failed
    // connection into a successful no-op, or the caller will persist a false
    // last_success_at and the retry will never happen.
    throw err;
  });

  try {
    const ownerId = await resolveOwnerId();
    if (ownerId === null) return;

    // Prune stale resolved rows so the ledger doesn't accumulate forever.
    // Re-announcing an ancient reopened issue after pruning is acceptable.
    const pruneResult = await client.query(
      `DELETE FROM sentry_seen_issues
       WHERE last_status = 'resolved'
         AND last_updated_at < NOW() - INTERVAL '${RESOLVED_RETENTION_DAYS} days'`,
    );
    if ((pruneResult.rowCount ?? 0) > 0) {
      logger.info(
        { pruned: pruneResult.rowCount },
        "sentry-error-nudges: pruned old resolved rows",
      );
    }

    // Fetch both lists so resolved issues can be marked in the seen ledger.
    const [unresolvedResult, resolvedResult] = await Promise.all([
      listSentryIssues({ environment: "production", query: "is:unresolved" }),
      listSentryIssues({ environment: "production", query: "is:resolved" }),
    ]);
    if (!unresolvedResult.configured || !resolvedResult.configured) return;

    const seenResult = await client.query<{
      issue_id: string;
      last_status: string;
      alert_generation: number;
    }>(
      `SELECT issue_id, last_status, alert_generation FROM sentry_seen_issues`,
    );
    const seen = new Map(
      seenResult.rows.map((r) => [
        r.issue_id,
        { status: r.last_status, generation: r.alert_generation },
      ]),
    );

    // Mark previously-seen issues that Sentry now reports resolved.
    for (const issue of resolvedResult.issues) {
      const prev = seen.get(issue.id);
      if (prev && prev.status !== "resolved") {
        await client.query(
          `UPDATE sentry_seen_issues
           SET last_status = 'resolved', last_updated_at = NOW()
           WHERE issue_id = $1`,
          [issue.id],
        );
        seen.set(issue.id, { ...prev, status: "resolved" });
      }
    }

    // New = never seen, or seen but last recorded as resolved (reopened).
    // Each announcement carries a per-issue "alert generation" (1 for the
    // first alert, +1 on every reopen) so a resolve→reopen cycle within the
    // same UTC day still produces a DISTINCT nudge key, while an identical
    // retry of the same run (crash before the ledger write) recomputes the
    // same generation and stays idempotent.
    const newIssues = unresolvedResult.issues
      .map((issue) => {
        const prev = seen.get(issue.id);
        if (prev === undefined) return { issue, generation: 1 };
        if (prev.status === "resolved")
          return { issue, generation: prev.generation + 1 };
        return null;
      })
      .filter((entry): entry is { issue: SentryIssue; generation: number } =>
        Boolean(entry),
      );

    if (newIssues.length === 0) {
      logger.info(
        { unresolved: unresolvedResult.issues.length },
        "sentry-error-nudges: no new issues this run",
      );
      return;
    }

    // Optional fix suggestions — strictly best-effort, never blocking.
    const withSuggestions = await Promise.all(
      newIssues.map(async ({ issue }) => ({
        issue,
        suggestion: await generateFixSuggestion(issue),
      })),
    );

    const message = buildNudgeMessage(withSuggestions);
    // Key includes the sorted new `id:g<generation>` pairs so distinct
    // batches — including a same-day reopen of an already-announced issue —
    // never collide, while an identical retry of the same batch (e.g. a
    // crash after fetch but before the ledger write) recomputes the same key
    // and stays idempotent.
    const idsKey = newIssues
      .map(({ issue, generation }) => `${issue.id}:g${generation}`)
      .sort()
      .join(",")
      .slice(0, 120);
    const nudgeKey = `sentry_errors:${todayUtc()}:${idsKey}`;

    const insertResult = await client.query(
      `INSERT INTO elaine_nudges (user_id, source_app, nudge_key, message)
       VALUES ($1, 'admin', $2, $3)
       ON CONFLICT (user_id, nudge_key) DO NOTHING`,
      [ownerId, nudgeKey, message],
    );

    // Record every announced issue in the seen ledger so it stays quiet
    // until it reopens after a Sentry-side resolve. The generation is set to
    // the value used in this run's nudge key (explicit, not incremented in
    // SQL, so a retried run stays idempotent).
    for (const { issue, generation } of newIssues) {
      await client.query(
        `INSERT INTO sentry_seen_issues (issue_id, last_status, alert_generation, first_alerted_at, last_updated_at)
         VALUES ($1, 'unresolved', $2, NOW(), NOW())
         ON CONFLICT (issue_id) DO UPDATE SET
           last_status      = 'unresolved',
           alert_generation = EXCLUDED.alert_generation,
           last_updated_at  = NOW()`,
        [issue.id, generation],
      );
    }

    logger.info(
      {
        newIssues: newIssues.length,
        inserted: insertResult.rowCount ?? 0,
        unresolved: unresolvedResult.issues.length,
      },
      "sentry-error-nudges: run complete",
    );
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// In-process scheduler (same pattern as integrations-health-nudges)
// ---------------------------------------------------------------------------

export function startSentryErrorNudgeScheduler(): () => void {
  let stopped = false;
  let startupTimeout: ReturnType<typeof setTimeout> | null = null;

  const run = async (): Promise<void> => {
    if (!(await shouldRunScheduledTask(SENTRY_NUDGE_TASK_NAME, INTERVAL_MS))) {
      logger.info(
        "sentry-error-nudges: skipped (ran within the last 30 minutes)",
      );
      return;
    }
    const t0 = Date.now();
    try {
      // Retry the whole pass once on a transient DB/network blip (e.g. the
      // Supabase pooler's occasional "timeout exceeded when trying to
      // connect"/"Connection terminated unexpectedly"). Every write inside
      // computeAndStoreSentryErrorNudges is idempotent (ON CONFLICT ...
      // DO NOTHING / DO UPDATE), so re-running the full pass is safe. This
      // task only fires every 30 minutes, so without a retry a single blip
      // meant a full missed cycle — the SENTRY_NUDGE_TASK_NAME row's
      // last_success_at then fell far enough behind that the shared
      // scheduled-tasks-heartbeat monitor reported it "gone silent" and
      // tripped a Sentry Cron Monitoring alert email, even once the next
      // scheduled attempt would have succeeded on its own. Every other
      // in-process scheduler already retries its own DB claim/health-check
      // for exactly this reason (see scheduler-guard.ts); this one didn't.
      await withRetry(computeAndStoreSentryErrorNudges, {
        maxAttempts: 2,
        label: "sentry-error-nudges",
      });
      logger.info(
        { durationMs: Date.now() - t0 },
        "sentry-error-nudges: run finished",
      );
      await recordScheduledTaskSuccess(SENTRY_NUDGE_TASK_NAME);
    } catch (err) {
      logger.error(
        { err, durationMs: Date.now() - t0 },
        "sentry-error-nudges: run failed",
      );
      recordScheduledTaskFailure(SENTRY_NUDGE_TASK_NAME);
    }
  };

  startupTimeout = setTimeout(() => {
    startupTimeout = null;
    if (!stopped) void run();
  }, STARTUP_DELAY_MS);

  const interval = setInterval(() => void run(), INTERVAL_MS);
  interval.unref();

  logger.info(
    "sentry-error-nudges: started (in-process, runs every 30 minutes)",
  );

  return () => {
    stopped = true;
    if (startupTimeout !== null) {
      clearTimeout(startupTimeout);
      startupTimeout = null;
    }
    clearInterval(interval);
  };
}
