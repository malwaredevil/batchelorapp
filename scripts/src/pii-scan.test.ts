#!/usr/bin/env tsx
/**
 * pii-scan.test.ts — integration tests for the pii-scan.ts scanner logic.
 *
 * Uses only Node built-ins (node:assert, node:fs, node:os, node:path) so no
 * extra test-framework dependency is needed.  Run via:
 *   pnpm --filter @workspace/scripts run test
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  scanFile,
  shouldScanFile,
  SAFE_DOMAINS,
  SAFE_PHONE_NUMBERS,
  SCANNED_EXTENSIONS,
  EXCLUDED_PATH_PREFIXES,
  EMAIL_ENV_VARS,
  PHONE_NUMBER_ENV_VARS,
} from "./pii-scan.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTmpFile(
  content: string,
  ext: string,
  fn: (absPath: string, relPath: string) => void,
): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pii-scan-test-"));
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
// Tests: shouldScanFile
// ---------------------------------------------------------------------------

console.log("\npii-scan.test: shouldScanFile");

test("includes .ts files not in excluded paths", () => {
  assert.equal(shouldScanFile("src/someModule.ts"), true);
});

test("excludes .test.ts files", () => {
  assert.equal(shouldScanFile("src/someModule.test.ts"), false);
});

test("excludes .spec.ts files", () => {
  assert.equal(shouldScanFile("src/someModule.spec.ts"), false);
});

test("excludes .local/ prefix", () => {
  assert.equal(shouldScanFile(".local/state/something.ts"), false);
});

test("excludes .agents/ prefix", () => {
  assert.equal(shouldScanFile(".agents/memory/MEMORY.md"), false);
});

test("excludes node_modules/ prefix", () => {
  assert.equal(shouldScanFile("node_modules/lodash/index.js"), false);
});

test("excludes scripts/test-fixtures/ prefix", () => {
  assert.equal(shouldScanFile("scripts/test-fixtures/photo.ts"), false);
});

test("includes .yaml files", () => {
  assert.equal(shouldScanFile("lib/api-spec/sources/travels.yaml"), true);
});

test("excludes binary extensions (e.g. .png)", () => {
  assert.equal(shouldScanFile("assets/logo.png"), false);
});

test("includes .tsx files", () => {
  assert.equal(shouldScanFile("src/Component.tsx"), true);
});

test("includes .js files", () => {
  assert.equal(shouldScanFile("src/util.js"), true);
});

test("includes .jsx files", () => {
  assert.equal(shouldScanFile("src/Component.jsx"), true);
});

test("includes .mjs files", () => {
  assert.equal(shouldScanFile("src/module.mjs"), true);
});

test("includes .cjs files", () => {
  assert.equal(shouldScanFile("src/module.cjs"), true);
});

test("includes .json files", () => {
  assert.equal(shouldScanFile("package.json"), true);
});

test("includes .yml files", () => {
  assert.equal(shouldScanFile(".github/workflows/ci.yml"), true);
});

test("includes .md files", () => {
  assert.equal(shouldScanFile("README.md"), true);
});

test("includes .sh files", () => {
  assert.equal(shouldScanFile("scripts/post-merge.sh"), true);
});

test("includes .env.example files", () => {
  assert.equal(shouldScanFile(".env.example"), true);
});

test("includes .toml files", () => {
  assert.equal(shouldScanFile("config/settings.toml"), true);
});

test("includes .sql files", () => {
  assert.equal(shouldScanFile("migrations/001_init.sql"), true);
});

test("excludes .git/ prefix", () => {
  assert.equal(shouldScanFile(".git/config.ts"), false);
});

test("excludes .pnpm-store/ prefix", () => {
  assert.equal(shouldScanFile(".pnpm-store/v3/files/index.ts"), false);
});

test("excludes .cache/ prefix", () => {
  assert.equal(shouldScanFile(".cache/something.ts"), false);
});

test("excludes dist/ prefix", () => {
  assert.equal(shouldScanFile("dist/bundle.js"), false);
});

test("excludes coverage/ prefix", () => {
  assert.equal(shouldScanFile("coverage/data.ts"), false);
});

test("excludes .tsbuildinfo (exact filename match)", () => {
  assert.equal(shouldScanFile(".tsbuildinfo"), false);
});

test("excludes playwright-report/ directory", () => {
  assert.equal(shouldScanFile("playwright-report/results.json"), false);
});

test("excludes .replit (exact filename match)", () => {
  assert.equal(shouldScanFile(".replit"), false);
});

test("excludes replit.nix (exact filename match)", () => {
  assert.equal(shouldScanFile("replit.nix"), false);
});

test("excludes .replitignore (exact filename match)", () => {
  assert.equal(shouldScanFile(".replitignore"), false);
});

test("excludes .upm/ prefix", () => {
  assert.equal(shouldScanFile(".upm/store.json"), false);
});

test("excludes threat_model.md (exact filename match)", () => {
  assert.equal(shouldScanFile("threat_model.md"), false);
});

test("excludes artifacts/api-server/dist/ prefix", () => {
  assert.equal(shouldScanFile("artifacts/api-server/dist/index.js"), false);
});

test("excludes artifacts/modules/dist/ prefix", () => {
  assert.equal(shouldScanFile("artifacts/modules/dist/index.js"), false);
});

test("excludes artifacts/web/dist/ prefix", () => {
  assert.equal(shouldScanFile("artifacts/web/dist/index.js"), false);
});

test("excludes artifacts/elaine/dist/ prefix", () => {
  assert.equal(shouldScanFile("artifacts/elaine/dist/index.js"), false);
});

test("excludes apify-actors/ prefix", () => {
  assert.equal(
    shouldScanFile("apify-actors/hallmark-crawler/src/main.ts"),
    false,
  );
});

test("excludes attached_assets/ prefix", () => {
  assert.equal(shouldScanFile("attached_assets/screenshot.ts"), false);
});

test("excludes pnpm-lock.yaml (exact filename match)", () => {
  assert.equal(shouldScanFile("pnpm-lock.yaml"), false);
});

// ---------------------------------------------------------------------------
// Tests: EXCLUDED_PATH_PREFIXES size snapshot
//
// This assertion catches any silent addition or removal of an excluded prefix.
// If you need to add or remove an entry from EXCLUDED_PATH_PREFIXES, you MUST
// also update EXPECTED_EXCLUDED_PATH_PREFIXES_SIZE below — the mismatch is
// intentional friction to ensure the change is deliberate and reviewed, and
// to guarantee a matching per-entry shouldScanFile test is also added.
// ---------------------------------------------------------------------------

console.log("\npii-scan.test: EXCLUDED_PATH_PREFIXES size snapshot");

test("EXCLUDED_PATH_PREFIXES size is exactly as expected (update if you add/remove an entry)", () => {
  const EXPECTED_EXCLUDED_PATH_PREFIXES_SIZE = 23;
  assert.equal(
    EXCLUDED_PATH_PREFIXES.length,
    EXPECTED_EXCLUDED_PATH_PREFIXES_SIZE,
    `EXCLUDED_PATH_PREFIXES has ${EXCLUDED_PATH_PREFIXES.length} entries but expected ${EXPECTED_EXCLUDED_PATH_PREFIXES_SIZE}. ` +
      "If you intentionally added or removed a prefix, update EXPECTED_EXCLUDED_PATH_PREFIXES_SIZE in pii-scan.test.ts " +
      "AND add or remove the corresponding per-entry shouldScanFile test.",
  );
});

// ---------------------------------------------------------------------------
// Tests: SCANNED_EXTENSIONS size snapshot
//
// This assertion catches any silent addition or removal of a scanned extension.
// If you need to add or remove an entry from SCANNED_EXTENSIONS, you MUST also
// update EXPECTED_SCANNED_EXTENSIONS_SIZE below — the mismatch is intentional
// friction to ensure the change is deliberate and reviewed.
// ---------------------------------------------------------------------------

console.log("\npii-scan.test: SCANNED_EXTENSIONS size snapshot");

test("SCANNED_EXTENSIONS size is exactly as expected (update if you add/remove an entry)", () => {
  const EXPECTED_SCANNED_EXTENSIONS_SIZE = 14;
  assert.equal(
    SCANNED_EXTENSIONS.size,
    EXPECTED_SCANNED_EXTENSIONS_SIZE,
    `SCANNED_EXTENSIONS has ${SCANNED_EXTENSIONS.size} entries but expected ${EXPECTED_SCANNED_EXTENSIONS_SIZE}. ` +
      "If you intentionally added or removed an extension, update EXPECTED_SCANNED_EXTENSIONS_SIZE in pii-scan.test.ts " +
      "AND add or remove the corresponding per-entry shouldScanFile test.",
  );
});

// ---------------------------------------------------------------------------
// Tests: SAFE_DOMAINS coverage
// ---------------------------------------------------------------------------

console.log("\npii-scan.test: SAFE_DOMAINS");

test("app.batchelor.app is in SAFE_DOMAINS (system address)", () => {
  assert.ok(SAFE_DOMAINS.has("app.batchelor.app"));
});

test("example.com is in SAFE_DOMAINS (RFC 2606 placeholder)", () => {
  assert.ok(SAFE_DOMAINS.has("example.com"));
});

test("github.com is in SAFE_DOMAINS (package registry / tooling host)", () => {
  assert.ok(SAFE_DOMAINS.has("github.com"));
});

test("resend.com is in SAFE_DOMAINS (email infrastructure)", () => {
  assert.ok(SAFE_DOMAINS.has("resend.com"));
});

test("sentry.io is in SAFE_DOMAINS (monitoring / observability)", () => {
  assert.ok(SAFE_DOMAINS.has("sentry.io"));
});

test("googleapis.com is in SAFE_DOMAINS (auth / API provider)", () => {
  assert.ok(SAFE_DOMAINS.has("googleapis.com"));
});

test("group.calendar.google.com is in SAFE_DOMAINS (Google Calendar IDs are not real email addresses)", () => {
  assert.ok(SAFE_DOMAINS.has("group.calendar.google.com"));
});

test("github.io is in SAFE_DOMAINS (GitHub Pages / package-docs host)", () => {
  assert.ok(SAFE_DOMAINS.has("github.io"));
});

test("githubusercontent.com is in SAFE_DOMAINS (GitHub raw-content CDN)", () => {
  assert.ok(SAFE_DOMAINS.has("githubusercontent.com"));
});

test("actions.github.com is in SAFE_DOMAINS (GitHub Actions infrastructure)", () => {
  assert.ok(SAFE_DOMAINS.has("actions.github.com"));
});

test("noreply.github.com is in SAFE_DOMAINS (GitHub no-reply commit emails)", () => {
  assert.ok(SAFE_DOMAINS.has("noreply.github.com"));
});

test("google.com is in SAFE_DOMAINS (auth / API provider root domain)", () => {
  assert.ok(SAFE_DOMAINS.has("google.com"));
});

test("accounts.google.com is in SAFE_DOMAINS (Google OAuth endpoint)", () => {
  assert.ok(SAFE_DOMAINS.has("accounts.google.com"));
});

test("batchelor.app is in SAFE_DOMAINS (project root domain)", () => {
  assert.ok(SAFE_DOMAINS.has("batchelor.app"));
});

test("sendgrid.com is in SAFE_DOMAINS (email infrastructure)", () => {
  assert.ok(SAFE_DOMAINS.has("sendgrid.com"));
});

test("mailgun.com is in SAFE_DOMAINS (email infrastructure)", () => {
  assert.ok(SAFE_DOMAINS.has("mailgun.com"));
});

test("example.org is in SAFE_DOMAINS (RFC 2606 placeholder)", () => {
  assert.ok(SAFE_DOMAINS.has("example.org"));
});

test("example.net is in SAFE_DOMAINS (RFC 2606 placeholder)", () => {
  assert.ok(SAFE_DOMAINS.has("example.net"));
});

test("example.co.uk is in SAFE_DOMAINS (RFC 2606 placeholder)", () => {
  assert.ok(SAFE_DOMAINS.has("example.co.uk"));
});

test("test.com is in SAFE_DOMAINS (common test suffix)", () => {
  assert.ok(SAFE_DOMAINS.has("test.com"));
});

test("test.org is in SAFE_DOMAINS (common test suffix)", () => {
  assert.ok(SAFE_DOMAINS.has("test.org"));
});

test("test.local is in SAFE_DOMAINS (common test suffix)", () => {
  assert.ok(SAFE_DOMAINS.has("test.local"));
});

test("localhost is in SAFE_DOMAINS (loopback / dev host)", () => {
  assert.ok(SAFE_DOMAINS.has("localhost"));
});

test("npmjs.org is in SAFE_DOMAINS (package registry)", () => {
  assert.ok(SAFE_DOMAINS.has("npmjs.org"));
});

test("npmjs.com is in SAFE_DOMAINS (package registry)", () => {
  assert.ok(SAFE_DOMAINS.has("npmjs.com"));
});

test("domain.com is in SAFE_DOMAINS (prompt example string)", () => {
  assert.ok(SAFE_DOMAINS.has("domain.com"));
});

test("clinic.com is in SAFE_DOMAINS (prompt example string)", () => {
  assert.ok(SAFE_DOMAINS.has("clinic.com"));
});

test("example.test is in SAFE_DOMAINS (RFC 6761 reserved TLD)", () => {
  assert.ok(SAFE_DOMAINS.has("example.test"));
});

test("gmail.com is NOT in SAFE_DOMAINS (household personal domain)", () => {
  assert.ok(!SAFE_DOMAINS.has("gmail.com"));
});

test("hotmail.com is NOT in SAFE_DOMAINS (household personal domain)", () => {
  assert.ok(!SAFE_DOMAINS.has("hotmail.com"));
});

test("yahoo.com is NOT in SAFE_DOMAINS (household personal domain)", () => {
  assert.ok(!SAFE_DOMAINS.has("yahoo.com"));
});

test("outlook.com is NOT in SAFE_DOMAINS (household personal domain)", () => {
  assert.ok(!SAFE_DOMAINS.has("outlook.com"));
});

test("icloud.com is NOT in SAFE_DOMAINS (household personal domain)", () => {
  assert.ok(!SAFE_DOMAINS.has("icloud.com"));
});

// ---------------------------------------------------------------------------
// Tests: SAFE_PHONE_NUMBERS coverage
// ---------------------------------------------------------------------------

console.log("\npii-scan.test: SAFE_PHONE_NUMBERS");

test("+12105551234 is in SAFE_PHONE_NUMBERS (NANP 555 placeholder)", () => {
  assert.ok(SAFE_PHONE_NUMBERS.has("+12105551234"));
});

test("+12025551234 is in SAFE_PHONE_NUMBERS (NANP 555 placeholder)", () => {
  assert.ok(SAFE_PHONE_NUMBERS.has("+12025551234"));
});

test("+12125551234 is in SAFE_PHONE_NUMBERS (NANP 555 placeholder)", () => {
  assert.ok(SAFE_PHONE_NUMBERS.has("+12125551234"));
});

test("+14155551234 is in SAFE_PHONE_NUMBERS (NANP 555 placeholder)", () => {
  assert.ok(SAFE_PHONE_NUMBERS.has("+14155551234"));
});

test("+13105551234 is in SAFE_PHONE_NUMBERS (NANP 555 placeholder)", () => {
  assert.ok(SAFE_PHONE_NUMBERS.has("+13105551234"));
});

test("+10000000000 is in SAFE_PHONE_NUMBERS (all-zeros unit test fixture)", () => {
  assert.ok(SAFE_PHONE_NUMBERS.has("+10000000000"));
});

test("+11111111111 is in SAFE_PHONE_NUMBERS (all-ones unit test fixture)", () => {
  assert.ok(SAFE_PHONE_NUMBERS.has("+11111111111"));
});

test("+447700900000 is in SAFE_PHONE_NUMBERS (UK Ofcom reserved range 07700 900NNN)", () => {
  assert.ok(SAFE_PHONE_NUMBERS.has("+447700900000"));
});

test("+447911123456 is in SAFE_PHONE_NUMBERS (UK Ofcom reserved range 07911 123NNN)", () => {
  assert.ok(SAFE_PHONE_NUMBERS.has("+447911123456"));
});

// ---------------------------------------------------------------------------
// Tests: allowlist size snapshots
//
// These assertions catch any silent widening of SAFE_DOMAINS or
// SAFE_PHONE_NUMBERS.  If you need to add a new entry to either set,
// you MUST update the expected count below as well — the mismatch
// is intentional friction to ensure allowlist changes are deliberate.
// ---------------------------------------------------------------------------

console.log("\npii-scan.test: allowlist size snapshots");

test("SAFE_DOMAINS size is exactly as expected (update if you add/remove an entry)", () => {
  // Count of entries in the SAFE_DOMAINS Set in pii-scan.ts.
  // Any addition to that set must be reflected here.
  const EXPECTED_SAFE_DOMAINS_SIZE = 28;
  assert.equal(
    SAFE_DOMAINS.size,
    EXPECTED_SAFE_DOMAINS_SIZE,
    `SAFE_DOMAINS has ${SAFE_DOMAINS.size} entries but expected ${EXPECTED_SAFE_DOMAINS_SIZE}. ` +
      "If you intentionally added or removed an entry, update EXPECTED_SAFE_DOMAINS_SIZE in pii-scan.test.ts. " +
      "NEVER add personal-email provider domains (gmail.com, yahoo.com, hotmail.com, outlook.com, icloud.com, etc.).",
  );
});

test("SAFE_PHONE_NUMBERS size is exactly as expected (update if you add/remove an entry)", () => {
  // Count of entries in the SAFE_PHONE_NUMBERS Set in pii-scan.ts.
  // Any addition to that set must be reflected here.
  const EXPECTED_SAFE_PHONE_NUMBERS_SIZE = 9;
  assert.equal(
    SAFE_PHONE_NUMBERS.size,
    EXPECTED_SAFE_PHONE_NUMBERS_SIZE,
    `SAFE_PHONE_NUMBERS has ${SAFE_PHONE_NUMBERS.size} entries but expected ${EXPECTED_SAFE_PHONE_NUMBERS_SIZE}. ` +
      "If you intentionally added or removed an entry, update EXPECTED_SAFE_PHONE_NUMBERS_SIZE in pii-scan.test.ts. " +
      "NEVER add real household phone numbers to this set.",
  );
});

// ---------------------------------------------------------------------------
// Tests: scanFile — email detection
// ---------------------------------------------------------------------------

console.log("\npii-scan.test: scanFile — email");

test("flags a household email address (gmail.com)", () => {
  withTmpFile(
    'const owner = "alice@gmail.com";\n',
    ".ts",
    (absPath, relPath) => {
      const findings = scanFile(absPath, relPath, []);
      assert.equal(findings.length, 1, "expected exactly 1 finding");
      assert.equal(findings[0].kind, "email");
      assert.equal(findings[0].value, "alice@gmail.com");
    },
  );
});

test("flags a household email address (yahoo.com)", () => {
  withTmpFile("// contact: bob@yahoo.com\n", ".ts", (absPath, relPath) => {
    const findings = scanFile(absPath, relPath, []);
    assert.equal(findings.length, 1, "expected exactly 1 finding");
    assert.equal(findings[0].kind, "email");
    assert.equal(findings[0].value, "bob@yahoo.com");
  });
});

test("flags a household email address (hotmail.com)", () => {
  withTmpFile("email: carol@hotmail.com\n", ".yaml", (absPath, relPath) => {
    const findings = scanFile(absPath, relPath, []);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].value, "carol@hotmail.com");
  });
});

test("does NOT flag a system address on app.batchelor.app", () => {
  withTmpFile(
    'const FROM = "elaine@app.batchelor.app";\n',
    ".ts",
    (absPath, relPath) => {
      const findings = scanFile(absPath, relPath, []);
      assert.equal(findings.length, 0, "expected no findings for safe domain");
    },
  );
});

test("does NOT flag an RFC 2606 placeholder address", () => {
  withTmpFile(
    "RESEND_FROM_EMAIL=noreply@example.com\n",
    ".sh",
    (absPath, relPath) => {
      const findings = scanFile(absPath, relPath, []);
      assert.equal(findings.length, 0);
    },
  );
});

test("flags multiple household emails on different lines", () => {
  withTmpFile(
    [
      'const a = "alice@gmail.com";',
      'const b = "bob@yahoo.com";',
      'const c = "elaine@app.batchelor.app";',
    ].join("\n") + "\n",
    ".ts",
    (absPath, relPath) => {
      const findings = scanFile(absPath, relPath, []);
      // alice + bob flagged, elaine is safe
      assert.equal(findings.length, 2);
      const values = findings.map((f) => f.value);
      assert.ok(values.includes("alice@gmail.com"));
      assert.ok(values.includes("bob@yahoo.com"));
    },
  );
});

test("records correct 1-based line number for a finding", () => {
  withTmpFile(
    "// line 1\n// line 2\nconst x = 'alice@gmail.com';\n",
    ".ts",
    (absPath, relPath) => {
      const findings = scanFile(absPath, relPath, []);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].line, 3);
    },
  );
});

test("flags a household email passed as env-var literal even when domain is in SAFE_DOMAINS", () => {
  // Simulate AGENT_LOGIN_EMAIL = dev-owner@app.batchelor.app (a SAFE_DOMAIN).
  // The domain-based pass would normally skip this, but the env-var literal
  // pass must flag it because it's a real household member's address.
  const householdEmail = "dev-owner@app.batchelor.app";
  assert.ok(
    SAFE_DOMAINS.has("app.batchelor.app"),
    "pre-condition: app.batchelor.app must be a SAFE_DOMAIN for this test to be meaningful",
  );
  withTmpFile(
    `const loginEmail = "${householdEmail}";\n`,
    ".ts",
    (absPath, relPath) => {
      const findings = scanFile(
        absPath,
        relPath,
        [],
        [householdEmail.toLowerCase()],
      );
      assert.ok(
        findings.length >= 1,
        "expected at least one finding via env-var literal path",
      );
      const emailFinding = findings.find(
        (f) =>
          f.kind === "email" &&
          f.value.toLowerCase() === householdEmail.toLowerCase(),
      );
      assert.ok(
        emailFinding,
        "expected an email finding for the household address",
      );
      assert.ok(
        emailFinding!.detail.includes("env"),
        `expected env-var literal detail, got: ${emailFinding!.detail}`,
      );
    },
  );
});

test("does NOT flag a SAFE_DOMAINS email when it is not present as an env-var literal", () => {
  // When no household email literals are passed, a SAFE_DOMAIN address must
  // not produce any finding — the env-var literal path is the only extra gate.
  const safeEmail = "elaine@app.batchelor.app";
  assert.ok(
    SAFE_DOMAINS.has("app.batchelor.app"),
    "pre-condition: app.batchelor.app must be a SAFE_DOMAIN",
  );
  withTmpFile(`const FROM = "${safeEmail}";\n`, ".ts", (absPath, relPath) => {
    // No household emails passed — env-var literal pass is empty.
    const findings = scanFile(absPath, relPath, [], []);
    assert.equal(
      findings.length,
      0,
      "SAFE_DOMAIN email must not be flagged when it is not a known household env-var literal",
    );
  });
});

test("EMAIL_ENV_VARS contains at least AGENT_LOGIN_EMAIL", () => {
  // Snapshot the env-var list so any future removal is a deliberate, reviewed
  // change — analogous to the SAFE_DOMAINS / SAFE_PHONE_NUMBERS size checks.
  assert.ok(
    EMAIL_ENV_VARS.includes("AGENT_LOGIN_EMAIL"),
    "AGENT_LOGIN_EMAIL must be in EMAIL_ENV_VARS so dev login credentials are caught before reaching GitHub",
  );
});

// ---------------------------------------------------------------------------
// Tests: PHONE_NUMBER_ENV_VARS — size snapshot + per-entry presence checks
//
// These assertions catch any silent addition or removal of an entry from
// PHONE_NUMBER_ENV_VARS.  A refactor that accidentally drops a name (e.g.
// "AGENTPHONE_PHONE_NUMBER") would silently stop scanning for that household
// number without a test failure.  If you intentionally add or remove an entry
// from PHONE_NUMBER_ENV_VARS, you MUST update EXPECTED_PHONE_NUMBER_ENV_VARS_SIZE
// below AND add or remove the corresponding per-entry presence test.
// ---------------------------------------------------------------------------

console.log("\npii-scan.test: PHONE_NUMBER_ENV_VARS");

test("PHONE_NUMBER_ENV_VARS size is exactly as expected (update if you add/remove an entry)", () => {
  const EXPECTED_PHONE_NUMBER_ENV_VARS_SIZE = 3;
  assert.equal(
    PHONE_NUMBER_ENV_VARS.length,
    EXPECTED_PHONE_NUMBER_ENV_VARS_SIZE,
    `PHONE_NUMBER_ENV_VARS has ${PHONE_NUMBER_ENV_VARS.length} entries but expected ${EXPECTED_PHONE_NUMBER_ENV_VARS_SIZE}. ` +
      "If you intentionally added or removed an entry, update EXPECTED_PHONE_NUMBER_ENV_VARS_SIZE in pii-scan.test.ts " +
      "AND add or remove the corresponding per-entry presence test.",
  );
});

test("PHONE_NUMBER_ENV_VARS contains AGENTPHONE_PHONE_NUMBER", () => {
  assert.ok(
    PHONE_NUMBER_ENV_VARS.includes("AGENTPHONE_PHONE_NUMBER"),
    "AGENTPHONE_PHONE_NUMBER must be in PHONE_NUMBER_ENV_VARS so the provisioned AgentPhone number is caught before reaching GitHub",
  );
});

test("PHONE_NUMBER_ENV_VARS contains HOUSEHOLD_PHONE_NUMBER", () => {
  assert.ok(
    PHONE_NUMBER_ENV_VARS.includes("HOUSEHOLD_PHONE_NUMBER"),
    "HOUSEHOLD_PHONE_NUMBER must be in PHONE_NUMBER_ENV_VARS so the household phone number is caught before reaching GitHub",
  );
});

test("PHONE_NUMBER_ENV_VARS contains MY_PHONE_NUMBER", () => {
  assert.ok(
    PHONE_NUMBER_ENV_VARS.includes("MY_PHONE_NUMBER"),
    "MY_PHONE_NUMBER must be in PHONE_NUMBER_ENV_VARS so the owner's personal phone number is caught before reaching GitHub",
  );
});

// ---------------------------------------------------------------------------
// Tests: scanFile — phone detection
// ---------------------------------------------------------------------------

console.log("\npii-scan.test: scanFile — phone");

test("flags an E.164 phone number not in SAFE_PHONE_NUMBERS", () => {
  withTmpFile('const phone = "+19175550199";\n', ".ts", (absPath, relPath) => {
    const findings = scanFile(absPath, relPath, []);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].kind, "phone");
    assert.equal(findings[0].value, "+19175550199");
  });
});

test("does NOT flag a known safe 555 placeholder number", () => {
  withTmpFile(
    'const placeholder = "+12105551234";\n',
    ".ts",
    (absPath, relPath) => {
      const findings = scanFile(absPath, relPath, []);
      assert.equal(findings.length, 0);
    },
  );
});

test("flags a household phone passed as env-var literal", () => {
  const householdPhone = "+19175559876";
  withTmpFile(
    `const num = "${householdPhone}";\n`,
    ".ts",
    (absPath, relPath) => {
      // Pass the same number as an env-var literal — should be caught even
      // if we imagine it was in SAFE_PHONE_NUMBERS (it isn't, but this tests
      // the literal-match path explicitly).
      const findings = scanFile(absPath, relPath, [householdPhone]);
      assert.ok(findings.length >= 1, "expected at least one finding");
      assert.ok(findings.some((f) => f.value === householdPhone));
    },
  );
});

test("flags a SAFE_PHONE_NUMBERS entry that also appears as an env-var literal (env-var path only)", () => {
  // +12105551234 is in SAFE_PHONE_NUMBERS so the E.164 regex pass skips it.
  // But when it is also present as a household env-var literal the scanner
  // must still catch it — the env-var literal path runs unconditionally.
  const safeListedButRealNumber = "+12105551234";
  withTmpFile(
    `const phone = "${safeListedButRealNumber}";\n`,
    ".ts",
    (absPath, relPath) => {
      const findings = scanFile(absPath, relPath, [safeListedButRealNumber]);
      assert.ok(
        findings.length >= 1,
        "expected a finding via env-var literal path even though number is in SAFE_PHONE_NUMBERS",
      );
      const phoneFinding = findings.find(
        (f) => f.kind === "phone" && f.value === safeListedButRealNumber,
      );
      assert.ok(
        phoneFinding,
        "expected a phone finding for the household number",
      );
      assert.ok(
        phoneFinding!.detail.includes("env"),
        `expected env-var literal detail, got: ${phoneFinding!.detail}`,
      );
    },
  );
});

test("does NOT flag a phone number that is too short to match the E.164 regex", () => {
  // The PHONE_E164_RE requires \+[1-9]\d{6,14} — at least 7 total digits after
  // the '+' (one from [1-9] plus six from \d{6,14}).  "+123456" has only 6
  // digits after '+' so it falls below the minimum and must NOT be flagged.
  // (Note: "+1234567" has exactly 7 digits and *would* match — use 6 here.)
  withTmpFile('const short = "+123456";\n', ".ts", (absPath, relPath) => {
    const findings = scanFile(absPath, relPath, []);
    const phoneFindings = findings.filter((f) => f.kind === "phone");
    assert.equal(
      phoneFindings.length,
      0,
      "short number below E.164 minimum should not be flagged",
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: scanFile — clean file
// ---------------------------------------------------------------------------

console.log("\npii-scan.test: scanFile — clean files");

test("returns no findings for a file with no PII", () => {
  withTmpFile(
    [
      'import { z } from "zod";',
      "",
      "export const schema = z.object({",
      "  name: z.string(),",
      "});",
    ].join("\n") + "\n",
    ".ts",
    (absPath, relPath) => {
      const findings = scanFile(absPath, relPath, []);
      assert.equal(findings.length, 0);
    },
  );
});

test("returns no findings for a file with only safe-domain emails", () => {
  withTmpFile(
    [
      "# Config",
      "RESEND_FROM_EMAIL=noreply@batchelor.app",
      "ELAINE_FROM=elaine@app.batchelor.app",
      "SUPPORT=support@example.com",
    ].join("\n") + "\n",
    ".sh",
    (absPath, relPath) => {
      const findings = scanFile(absPath, relPath, []);
      assert.equal(findings.length, 0);
    },
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\npii-scan.test: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
