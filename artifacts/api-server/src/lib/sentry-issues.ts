/**
 * Sentry issues client — lists unresolved (or resolved) issues for the
 * configured org/project via the Sentry REST API, filterable by environment.
 *
 * Configuration comes from three optional env vars (SENTRY_AUTH_TOKEN,
 * SENTRY_ORG_SLUG, SENTRY_PROJECT_SLUG). When any is missing the client
 * reports a clean "not configured" state instead of throwing, so both the
 * owner-panel card and the proactive nudge scheduler can degrade gracefully.
 */

import { env } from "./env";

export type SentryEnvironment = "production" | "development";

export interface SentryIssue {
  /** Sentry's stable numeric issue id (as a string). */
  id: string;
  /** Human-readable short id, e.g. "NODE-EXPRESS-42". */
  shortId: string;
  title: string;
  culprit: string;
  /** Severity level: "error", "warning", "fatal", ... */
  level: string;
  /** Total event count for this issue (Sentry returns it as a string). */
  count: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  /** Link to view the issue on sentry.io. */
  permalink: string;
  status: string;
}

export type SentryIssuesResult =
  | { configured: false; issues: [] }
  | { configured: true; issues: SentryIssue[] };

interface SentryConfig {
  authToken: string;
  orgSlug: string;
  projectSlug: string;
}

/** Returns the Sentry API config, or null when any required value is missing. */
export function getSentryIssuesConfig(): SentryConfig | null {
  const authToken = env.sentryAuthToken;
  const orgSlug = env.sentryOrgSlug;
  const projectSlug = env.sentryProjectSlug;
  if (!authToken || !orgSlug || !projectSlug) return null;
  return { authToken, orgSlug, projectSlug };
}

export function isSentryIssuesConfigured(): boolean {
  return getSentryIssuesConfig() !== null;
}

/** Raw issue shape from Sentry's API (only the fields we consume). */
interface RawSentryIssue {
  id?: unknown;
  shortId?: unknown;
  title?: unknown;
  culprit?: unknown;
  level?: unknown;
  count?: unknown;
  userCount?: unknown;
  firstSeen?: unknown;
  lastSeen?: unknown;
  permalink?: unknown;
  status?: unknown;
}

function toIssue(raw: RawSentryIssue): SentryIssue {
  return {
    id: String(raw.id ?? ""),
    shortId: String(raw.shortId ?? ""),
    title: String(raw.title ?? "(untitled)"),
    culprit: String(raw.culprit ?? ""),
    level: String(raw.level ?? "error"),
    // Sentry serialises count as a string; tolerate numbers too.
    count: Number(raw.count ?? 0) || 0,
    userCount: Number(raw.userCount ?? 0) || 0,
    firstSeen: String(raw.firstSeen ?? ""),
    lastSeen: String(raw.lastSeen ?? ""),
    permalink: String(raw.permalink ?? ""),
    status: String(raw.status ?? "unresolved"),
  };
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_ISSUES = 50;

/**
 * List issues for the configured project, filtered by environment and
 * resolution status. Returns `{ configured: false }` (never throws) when the
 * required env vars are missing; throws on API/network errors so callers can
 * distinguish "not configured" from "temporarily failing".
 */
export async function listSentryIssues(options: {
  environment: SentryEnvironment;
  query?: "is:unresolved" | "is:resolved";
}): Promise<SentryIssuesResult> {
  const config = getSentryIssuesConfig();
  if (!config) return { configured: false, issues: [] };

  const params = new URLSearchParams({
    query: options.query ?? "is:unresolved",
    environment: options.environment,
    sort: "date",
    limit: String(MAX_ISSUES),
    statsPeriod: "14d",
  });
  const url = `https://sentry.io/api/0/projects/${config.orgSlug}/${config.projectSlug}/issues/?${params.toString()}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.authToken}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Sentry issues API returned ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("Sentry issues API returned a non-array response");
  }
  return {
    configured: true,
    issues: data.map((raw) => toIssue(raw as RawSentryIssue)),
  };
}
