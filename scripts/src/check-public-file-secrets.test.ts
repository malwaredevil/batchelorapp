#!/usr/bin/env tsx
/**
 * check-public-file-secrets.test.ts — unit tests for the secrets scanner.
 *
 * Uses only Node built-ins (node:assert, node:fs, node:os, node:path).
 * Run via: pnpm --filter @workspace/scripts run test
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  scanFile,
  PATTERNS,
  DOC_EXTENSIONS,
  SECRET_ENV_VARS,
  isExcluded,
} from "./check-public-file-secrets.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTmpFile(
  content: string,
  ext: string,
  fn: (absPath: string, relPath: string) => void,
): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cps-test-"));
  const absPath = path.join(dir, `fixture${ext}`);
  const relPath = `tmp/fixture${ext}`;
  try {
    fs.writeFileSync(absPath, content, "utf-8");
    fn(absPath, relPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Tests: pattern coverage (each pattern detects its target)
// ---------------------------------------------------------------------------

console.log("\ncheck-public-file-secrets.test: pattern detection");

test("detects Supabase project reference ID", () => {
  withTmpFile(
    "The Supabase project reference is gadhlfluflknlwgmlmos\n",
    ".md",
    (abs, rel) => {
      const findings = scanFile(abs, rel, []);
      assert.ok(
        findings.some(
          (f) => f.kind === "pattern" && f.patternId === "supabase-ref",
        ),
        "expected supabase-ref finding",
      );
    },
  );
});

test("detects screenshotToken in markdown docs", () => {
  withTmpFile(
    "Pass screenshotToken=abc in the query string.\n",
    ".md",
    (abs, rel) => {
      const findings = scanFile(abs, rel, []);
      assert.ok(
        findings.some(
          (f) => f.kind === "pattern" && f.patternId === "screenshot-token",
        ),
        "expected screenshot-token finding in .md",
      );
    },
  );
});

test("does NOT flag screenshotToken in TypeScript source files", () => {
  withTmpFile(
    'const token = req.query["screenshotToken"];\n',
    ".ts",
    (abs, rel) => {
      const findings = scanFile(abs, rel, []);
      assert.ok(
        !findings.some(
          (f) => f.kind === "pattern" && f.patternId === "screenshot-token",
        ),
        "screenshotToken must not be flagged in .ts source",
      );
    },
  );
});

test("detects sentry-baseline write with digit", () => {
  withTmpFile(
    "run sentry-baseline write 3 123,456,789\n",
    ".sh",
    (abs, rel) => {
      const findings = scanFile(abs, rel, []);
      assert.ok(
        findings.some(
          (f) => f.kind === "pattern" && f.patternId === "sentry-write",
        ),
        "expected sentry-write finding",
      );
    },
  );
});

test("detects long JWT token", () => {
  // 120-char fake JWT header.payload segment (not a real token)
  const fakeJwt = "eyJ" + "A".repeat(117);
  withTmpFile(`const key = "${fakeJwt}";\n`, ".ts", (abs, rel) => {
    const findings = scanFile(abs, rel, []);
    assert.ok(
      findings.some((f) => f.kind === "pattern" && f.patternId === "jwt-token"),
      "expected jwt-token finding",
    );
  });
});

test("does NOT flag short eyJ strings (valid JWT header prefix, not a full key)", () => {
  // A real JWT header is only ~20 chars encoded — far less than the 100-char threshold
  withTmpFile('const header = "eyJhbGciOiJIUzI1NiJ9";\n', ".ts", (abs, rel) => {
    const findings = scanFile(abs, rel, []);
    assert.ok(
      !findings.some(
        (f) => f.kind === "pattern" && f.patternId === "jwt-token",
      ),
      "short eyJ must not be flagged",
    );
  });
});

test("detects OpenAI-style sk- key", () => {
  withTmpFile(
    "const key = 'sk-abcdefghij1234567890abcdef';\n",
    ".ts",
    (abs, rel) => {
      const findings = scanFile(abs, rel, []);
      assert.ok(
        findings.some((f) => f.kind === "pattern" && f.patternId === "sk-key"),
        "expected sk-key finding",
      );
    },
  );
});

test("detects GitHub PAT", () => {
  withTmpFile(
    "token: ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n",
    ".yml",
    (abs, rel) => {
      const findings = scanFile(abs, rel, []);
      assert.ok(
        findings.some((f) => f.kind === "pattern" && f.patternId === "gh-pat"),
        "expected gh-pat finding",
      );
    },
  );
});

test("detects Google API key", () => {
  withTmpFile(
    "MAPS_KEY=AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\n",
    ".sh",
    (abs, rel) => {
      const findings = scanFile(abs, rel, []);
      assert.ok(
        findings.some(
          (f) => f.kind === "pattern" && f.patternId === "google-api-key",
        ),
        "expected google-api-key finding",
      );
    },
  );
});

test("detects Slack token", () => {
  withTmpFile(
    "SLACK_TOKEN=xoxb-12345678-12345678901-abcdefghij\n",
    ".sh",
    (abs, rel) => {
      const findings = scanFile(abs, rel, []);
      assert.ok(
        findings.some(
          (f) => f.kind === "pattern" && f.patternId === "slack-token",
        ),
        "expected slack-token finding",
      );
    },
  );
});

test("detects Resend API key", () => {
  withTmpFile("key = re_ABCDEFGHIJKLMNOPQRSTUVWXYZab\n", ".ts", (abs, rel) => {
    const findings = scanFile(abs, rel, []);
    assert.ok(
      findings.some(
        (f) => f.kind === "pattern" && f.patternId === "resend-key",
      ),
      "expected resend-key finding",
    );
  });
});

test("detects Google OAuth client ID", () => {
  withTmpFile(
    "client_id: 123456789012-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com\n",
    ".yml",
    (abs, rel) => {
      const findings = scanFile(abs, rel, []);
      assert.ok(
        findings.some(
          (f) => f.kind === "pattern" && f.patternId === "google-oauth-client",
        ),
        "expected google-oauth-client finding",
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Tests: env-var literal check
// ---------------------------------------------------------------------------

console.log("\ncheck-public-file-secrets.test: env-var literal check");

test("detects a literal secret value from env vars", () => {
  const fakeSecret = "super-secret-value-that-is-long-enough";
  withTmpFile(`const x = "${fakeSecret}";\n`, ".ts", (abs, rel) => {
    const findings = scanFile(abs, rel, [
      { envVar: "SESSION_SECRET", value: fakeSecret },
    ]);
    assert.ok(
      findings.some(
        (f) => f.kind === "secret-value" && f.envVar === "SESSION_SECRET",
      ),
      "expected secret-value finding",
    );
  });
});

test("does NOT flag short env var values (placeholders)", () => {
  withTmpFile("const x = 'short';\n", ".ts", (abs, rel) => {
    const findings = scanFile(abs, rel, [
      { envVar: "SESSION_SECRET", value: "short" },
    ]);
    // "short" is under MIN_SECRET_LENGTH so it won't be in secretValues
    // (this is enforced by loadSecretValues, not scanFile itself)
    assert.equal(
      findings.filter((f) => f.kind === "secret-value").length,
      0,
      "short values must not be flagged by scanFile if caller filters them",
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: clean files return no findings
// ---------------------------------------------------------------------------

console.log("\ncheck-public-file-secrets.test: clean files");

test("returns no findings for a clean TypeScript file", () => {
  withTmpFile(
    [
      'import { z } from "zod";',
      "",
      "export const schema = z.object({ name: z.string() });",
    ].join("\n") + "\n",
    ".ts",
    (abs, rel) => {
      assert.equal(scanFile(abs, rel, []).length, 0);
    },
  );
});

test("returns no findings for a clean markdown file", () => {
  withTmpFile(
    "# Project README\n\nSee .env.example for required environment variables.\n",
    ".md",
    (abs, rel) => {
      assert.equal(scanFile(abs, rel, []).length, 0);
    },
  );
});

test("variable reference $GH_PAT does NOT trigger (not a literal value)", () => {
  withTmpFile(
    'curl -H "Authorization: Bearer $GH_PAT" https://api.github.com\n',
    ".sh",
    (abs, rel) => {
      // No secret value provided — only env-var names in the file, not values
      assert.equal(scanFile(abs, rel, []).length, 0);
    },
  );
});

// ---------------------------------------------------------------------------
// Tests: isExcluded
// ---------------------------------------------------------------------------

console.log("\ncheck-public-file-secrets.test: isExcluded");

test("excludes .agents/ paths", () => {
  assert.equal(isExcluded(".agents/memory/MEMORY.md"), true);
});

test("excludes .local/ paths", () => {
  assert.equal(isExcluded(".local/ops-runbook.md"), true);
});

test("excludes threat_model.md", () => {
  assert.equal(isExcluded("threat_model.md"), true);
});

test("does NOT exclude AGENTS.md (public file)", () => {
  assert.equal(isExcluded("AGENTS.md"), false);
});

test("does NOT exclude replit.md (public file)", () => {
  assert.equal(isExcluded("replit.md"), false);
});

// ---------------------------------------------------------------------------
// Tests: DOC_EXTENSIONS
// ---------------------------------------------------------------------------

console.log("\ncheck-public-file-secrets.test: DOC_EXTENSIONS");

test("DOC_EXTENSIONS includes .md, .sh, .yml", () => {
  assert.ok(DOC_EXTENSIONS.has(".md"));
  assert.ok(DOC_EXTENSIONS.has(".sh"));
  assert.ok(DOC_EXTENSIONS.has(".yml"));
});

test("DOC_EXTENSIONS does not include .ts", () => {
  assert.ok(!DOC_EXTENSIONS.has(".ts"));
});

// ---------------------------------------------------------------------------
// Tests: SECRET_ENV_VARS list is non-empty and contains expected vars
// ---------------------------------------------------------------------------

console.log("\ncheck-public-file-secrets.test: SECRET_ENV_VARS");

test("SECRET_ENV_VARS contains SESSION_SECRET", () => {
  assert.ok(SECRET_ENV_VARS.includes("SESSION_SECRET"));
});

test("SECRET_ENV_VARS contains GH_PAT", () => {
  assert.ok(SECRET_ENV_VARS.includes("GH_PAT"));
});

test("SECRET_ENV_VARS contains SLACK_BOT_TOKEN", () => {
  assert.ok(SECRET_ENV_VARS.includes("SLACK_BOT_TOKEN"));
});

// ---------------------------------------------------------------------------
// Tests: PATTERNS list coverage
// ---------------------------------------------------------------------------

console.log("\ncheck-public-file-secrets.test: PATTERNS list");

test("all patterns have non-empty id and label", () => {
  for (const rule of PATTERNS) {
    assert.ok(
      rule.id.length > 0,
      `pattern missing id: ${JSON.stringify(rule)}`,
    );
    assert.ok(rule.label.length > 0, `pattern missing label for id=${rule.id}`);
  }
});

test("pattern ids are unique", () => {
  const ids = PATTERNS.map((r) => r.id);
  const unique = new Set(ids);
  assert.equal(ids.length, unique.size, "duplicate pattern ids found");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(
  `\ncheck-public-file-secrets.test: ${passed} passed, ${failed} failed\n`,
);

if (failed > 0) {
  process.exit(1);
}
