import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  HOUNDDOG_RELEASE,
  scannerEnvironment,
  verifySha256,
} from "./hounddog-tool.js";
import {
  parseHounddogReport,
  requiresPrivacyReview,
} from "./hounddog-report.js";
import { sourceFiles } from "./hounddog.js";
import { scannerPath, verifySourceCoverage } from "./hounddog-coverage.js";

function report(severity = "critical") {
  return {
    hounddog_version: HOUNDDOG_RELEASE.version,
    start_time: "2026-10-18T00:00:00Z",
    end_time: "2026-10-18T00:00:01Z",
    data_element_occurrences: [],
    data_sink_occurrences: [],
    dataflows: [
      {
        hash: "sample-fingerprint",
        severity,
        data_sink_slug: "stdout",
        code_segment: { rel_file_path: "app.ts", line_start: 7 },
        data_elements: [{ data_element_slug: "password" }],
      },
    ],
  };
}
const files = new Set(["app.ts"]);

void test("critical findings block even though the native scanner exits zero", () => {
  assert.equal(
    requiresPrivacyReview(parseHounddogReport(report(), files)),
    true,
  );
});
void test("medium findings require review, low/info remain visible but nonblocking", () => {
  assert.equal(
    requiresPrivacyReview(parseHounddogReport(report("medium"), files)),
    true,
  );
  for (const severity of ["low", "info"]) {
    assert.equal(
      requiresPrivacyReview(parseHounddogReport(report(severity), files)),
      false,
    );
  }
});
void test("valid empty reports are accepted only for a nonempty source scope", () => {
  const empty = { ...report(), dataflows: [] };
  assert.deepEqual(parseHounddogReport(empty, files), []);
  assert.throws(() => parseHounddogReport(empty, new Set()));
});
void test("missing schema, version drift, bad timestamps and unknown severities fail closed", () => {
  for (const invalid of [
    null,
    {},
    [],
    { ...report(), dataflows: undefined },
    { ...report(), hounddog_version: "unexpected" },
    { ...report(), end_time: "not-a-time" },
    report("unknown"),
  ])
    assert.throws(() => parseHounddogReport(invalid, files));
});
void test("unscanned paths, invalid lines and missing data elements fail closed", () => {
  const original = report().dataflows[0]!;
  for (const flow of [
    {
      ...original,
      code_segment: { rel_file_path: "../private.ts", line_start: 1 },
    },
    { ...original, code_segment: { rel_file_path: "app.ts", line_start: 0 } },
    { ...original, data_elements: [] },
    { ...original, data_elements: [{}] },
  ]) {
    assert.throws(() =>
      parseHounddogReport({ ...report(), dataflows: [flow] }, files),
    );
  }
});
void test("source snippets and raw data never enter the summarized findings", () => {
  const input = report();
  Object.assign(input.dataflows[0]!.code_segment, {
    content: "private source text",
  });
  const summary = JSON.stringify(parseHounddogReport(input, files));
  assert.ok(!summary.includes("private source text"));
});
void test("pinned archive and cached executable checks reject tampering", () => {
  const bytes = Buffer.from("synthetic executable");
  const digest = createHash("sha256").update(bytes).digest("hex");
  verifySha256(bytes, digest);
  assert.throws(
    () => verifySha256(Buffer.from("altered"), digest),
    /checksum mismatch/,
  );
});
void test("scanner environment contains no inherited credentials or vendor/AI configuration", () => {
  const env = scannerEnvironment("/isolated-home");
  assert.deepEqual(Object.keys(env).sort(), [
    "HOME",
    "LANG",
    "TMPDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
  ]);
  assert.equal(env.HOME, "/isolated-home");
});
void test("source inventory excludes secrets, tests, symlinks and generated reports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-scope-test-"));
  try {
    execFileSync("git", ["init", "--quiet", root]);
    fs.mkdirSync(path.join(root, "src"));
    fs.mkdirSync(path.join(root, ".local"));
    fs.writeFileSync(path.join(root, ".gitignore"), ".local/\n");
    fs.writeFileSync(path.join(root, "src/app.ts"), "export const value = 1;");
    fs.writeFileSync(path.join(root, "src/app.test.ts"), "// synthetic test");
    fs.writeFileSync(path.join(root, ".env"), "DO_NOT_SCAN=synthetic");
    fs.writeFileSync(path.join(root, ".local/private.ts"), "// internal");
    fs.mkdirSync(path.join(root, "apify-actors/example/src"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, "apify-actors/example/src/crawler.ts"),
      "export const source = true;",
    );
    fs.writeFileSync(
      path.join(root, "apify-actors/example/src/crawler.test.ts"),
      "// excluded",
    );
    fs.mkdirSync(path.join(root, "generated-artifacts"));
    fs.writeFileSync(
      path.join(root, "generated-artifacts/private.ts"),
      "// generated private report not yet gitignored",
    );
    fs.symlinkSync(path.join(root, ".env"), path.join(root, "src/link.ts"));
    assert.deepEqual(sourceFiles(root), [
      "apify-actors/example/src/crawler.ts",
      "src/app.ts",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

void test("scanner staging avoids ignored directory names without changing repository paths", () => {
  assert.equal(
    scannerPath("artifacts/api-server/src/main.ts"),
    "applications/api-server/src/main.ts",
  );
  assert.equal(
    scannerPath("apify-actors/crawler/src/main.js"),
    "actors/crawler/src/main.js",
  );
  assert.equal(scannerPath("lib/shared/src/main.ts"), "lib/shared/src/main.ts");
});

void test("global canary success cannot substitute for application-source coverage", () => {
  const flows = parseHounddogReport(report(), files);
  assert.throws(() =>
    verifySourceCoverage(
      report(),
      flows,
      ["applications/api/src/probe.ts"],
      files,
    ),
  );
});

void test("each application/actor scope needs both positive leak types", () => {
  const probe = "applications/api/src/probe.ts";
  const base = parseHounddogReport(report(), files)[0]!;
  const flows = [
    { ...base, file: probe },
    { ...base, file: probe, types: ["email"], severity: "low" as const },
  ];
  const inventory = new Set(["applications/api/src/main.ts"]);
  const input = {
    ...report(),
    data_element_occurrences: [
      { code_segment: { rel_file_path: "applications/api/src/main.ts" } },
    ],
  };
  assert.equal(
    verifySourceCoverage(input, flows, [probe], inventory)
      .applicationFilesWithOccurrences,
    1,
  );
  assert.throws(() =>
    verifySourceCoverage(
      input,
      flows,
      [probe, "actors/demo/src/probe.ts"],
      inventory,
    ),
  );
  assert.throws(() =>
    verifySourceCoverage(input, [flows[0]!], [probe], inventory),
  );
  assert.throws(() =>
    verifySourceCoverage(report(), flows, [probe], inventory),
  );
});
