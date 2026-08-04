/**
 * sentry-baseline.ts
 * Writes or reads the Sentry issue baseline used by the pre-publish checklist.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run sentry-baseline write   # before touching code
 *   pnpm --filter @workspace/scripts run sentry-baseline read    # show current baseline
 *   pnpm --filter @workspace/scripts run sentry-baseline clear   # after stage 4 completes
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const STATE_FILE = path.join(
  REPO_ROOT,
  ".local",
  "state",
  "sentry-baseline.json",
);
const STAGE4_FILE = path.join(
  REPO_ROOT,
  ".local",
  "state",
  "pending-stage4.json",
);

type BaselineFile = {
  count: number;
  ids: string[];
  writtenAt: string;
};

type Stage4File = {
  publishedAt: string;
  baselineCount: number;
  baselineIds: string[];
  releaseVersion?: string;
};

function ensureDir(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function getGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

async function notifySentryRelease(version: string): Promise<void> {
  const webhookUrl = process.env.SENTRY_RELEASE_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log(
      "  ⚠  SENTRY_RELEASE_WEBHOOK_URL not set — skipping release notification.",
    );
    return;
  }
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    });
    if (res.ok) {
      console.log(
        `  ✓ Sentry release created: ${version} (HTTP ${res.status})`,
      );
    } else {
      const body = await res.text();
      console.warn(
        `  ⚠  Sentry release webhook returned ${res.status}: ${body.slice(0, 200)}`,
      );
    }
  } catch (err) {
    console.warn(
      `  ⚠  Sentry release webhook failed (non-fatal): ${(err as Error).message}`,
    );
  }
}

/**
 * The release-tracking webhook above only CREATES an "unreleased" (open)
 * Sentry release — it never sets dateReleased. Without that, the release
 * sits forever with 0% adoption and a "Finalize" button in the Releases UI.
 * Finalize it ourselves right after creation so releases don't pile up
 * requiring manual clicks in the Sentry dashboard.
 */
async function finalizeSentryRelease(version: string): Promise<void> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  const orgSlug = process.env.SENTRY_ORG_SLUG;
  const projectSlug = process.env.SENTRY_PROJECT_SLUG;
  if (!token || !orgSlug || !projectSlug) {
    console.log(
      "  ⚠  SENTRY_AUTH_TOKEN/SENTRY_ORG_SLUG/SENTRY_PROJECT_SLUG not set — skipping release finalize.",
    );
    return;
  }
  const url = `https://sentry.io/api/0/organizations/${orgSlug}/releases/${encodeURIComponent(version)}/`;
  const body = JSON.stringify({
    dateReleased: new Date().toISOString(),
    projects: [projectSlug],
  });
  // The webhook above may still be processing when we call this, so retry a
  // couple of times on 404 before giving up.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body,
      });
      if (res.ok) {
        console.log(`  ✓ Sentry release finalized: ${version}`);
        return;
      }
      if (res.status === 404 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      const text = await res.text();
      console.warn(
        `  ⚠  Sentry release finalize returned ${res.status}: ${text.slice(0, 200)}`,
      );
      return;
    } catch (err) {
      console.warn(
        `  ⚠  Sentry release finalize failed (non-fatal): ${(err as Error).message}`,
      );
      return;
    }
  }
}

const cmd = process.argv[2];

if (cmd === "write") {
  const count = parseInt(process.argv[3] ?? "0", 10);
  const ids: string[] = process.argv[4] ? process.argv[4].split(",") : [];
  const data: BaselineFile = {
    count,
    ids,
    writtenAt: new Date().toISOString(),
  };
  ensureDir(STATE_FILE);
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
  console.log(
    `Sentry baseline written: ${count} issue(s) at ${data.writtenAt}`,
  );
} else if (cmd === "read") {
  if (!fs.existsSync(STATE_FILE)) {
    console.log(
      "No baseline file found. Run 'sentry-baseline write <count>' first.",
    );
    process.exit(1);
  }
  const data: BaselineFile = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  console.log(
    `Baseline: ${data.count} issue(s), recorded at ${data.writtenAt}`,
  );
  if (data.ids.length) console.log(`IDs: ${data.ids.join(", ")}`);
} else if (cmd === "mark-published") {
  const baselineData: BaselineFile = fs.existsSync(STATE_FILE)
    ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
    : { count: 0, ids: [], writtenAt: new Date().toISOString() };

  const releaseVersion = getGitSha();

  const stage4: Stage4File = {
    publishedAt: new Date().toISOString(),
    baselineCount: baselineData.count,
    baselineIds: baselineData.ids,
    releaseVersion,
  };
  ensureDir(STAGE4_FILE);
  fs.writeFileSync(STAGE4_FILE, JSON.stringify(stage4, null, 2));
  console.log(
    `Stage 4 pending file written. Baseline was ${baselineData.count} issue(s).`,
  );

  console.log(`Notifying Sentry of release: ${releaseVersion}`);
  await notifySentryRelease(releaseVersion);
  await finalizeSentryRelease(releaseVersion);

  console.log(
    "At the start of the next session, the agent will check for new Sentry issues.",
  );
} else if (cmd === "clear") {
  [STATE_FILE, STAGE4_FILE].forEach((f) => {
    if (fs.existsSync(f)) {
      fs.unlinkSync(f);
      console.log(`Deleted ${f}`);
    }
  });
  console.log("Sentry state files cleared.");
} else if (cmd === "check-pending-stage4") {
  if (!fs.existsSync(STAGE4_FILE)) {
    console.log("No pending Stage 4 check.");
    process.exit(0);
  }
  const data: Stage4File = JSON.parse(fs.readFileSync(STAGE4_FILE, "utf8"));
  const age = Date.now() - new Date(data.publishedAt).getTime();
  const hours = age / 1000 / 60 / 60;
  if (hours > 24) {
    console.log(
      `Pending Stage 4 file is ${hours.toFixed(1)}h old — expired, clearing.`,
    );
    fs.unlinkSync(STAGE4_FILE);
    process.exit(0);
  }
  console.log(
    `PENDING_STAGE4: published at ${data.publishedAt} (${hours.toFixed(1)}h ago), baseline=${data.baselineCount}${data.releaseVersion ? `, release=${data.releaseVersion}` : ""}`,
  );
  process.exit(2);
} else {
  console.error(
    "Usage: sentry-baseline <write <count> [ids]|read|mark-published|clear|check-pending-stage4>",
  );
  process.exit(1);
}
