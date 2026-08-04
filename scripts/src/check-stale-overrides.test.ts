import assert from "node:assert/strict";
import {
  parseSecurityOverrides,
  parseResolvedVersions,
  checkOverrides,
} from "./check-stale-overrides.js";

// ---------------------------------------------------------------------------
// parseSecurityOverrides
// ---------------------------------------------------------------------------

const SAMPLE_WORKSPACE = `
overrides:
  # plain override without a security comment — should be skipped
  some-package: "^1.0.0"
  # Security overrides
  dompurify: ">=3.4.12 <4" # GHSA-xxx: XSS bypass; patched 3.4.12
  fast-uri: ">=3.1.5 <4" # CVE-2026-18446 / GHSA-abc: host confusion
  adm-zip: ">=0.5.19 <1" # CVE-2024-26256: arbitrary-file-write
  "brace-expansion@^1": "^1.1.18" # CVE-2026-14257: OOM DoS
  "brace-expansion@^5": "^5.0.9" # GHSA-rgw5-rvv9-x895: DoS
  js-yaml: 4.3.0
catalog:
  react: 19.1.0
`;

const overrides = parseSecurityOverrides(SAMPLE_WORKSPACE);

// Should detect dompurify, fast-uri, adm-zip, brace-expansion@^1, brace-expansion@^5
// Should skip some-package (no CVE/GHSA) and js-yaml (no CVE/GHSA comment)
assert.equal(
  overrides.length,
  5,
  `expected 5 security overrides, got ${overrides.length}: ${overrides.map((o) => o.key).join(", ")}`,
);

const domOverride = overrides.find((o) => o.key === "dompurify");
assert.ok(domOverride, "dompurify override should be detected");
assert.equal(domOverride!.packageName, "dompurify");
assert.equal(domOverride!.majorScope, null);
assert.equal(domOverride!.floor, "3.4.12");

const fastUriOverride = overrides.find((o) => o.key === "fast-uri");
assert.ok(fastUriOverride, "fast-uri override should be detected");
assert.equal(fastUriOverride!.floor, "3.1.5");

const admZipOverride = overrides.find((o) => o.key === "adm-zip");
assert.ok(admZipOverride, "adm-zip override should be detected");
assert.equal(admZipOverride!.floor, "0.5.19");

const braceV1 = overrides.find((o) => o.key === "brace-expansion@^1");
assert.ok(braceV1, "brace-expansion@^1 override should be detected");
assert.equal(braceV1!.packageName, "brace-expansion");
assert.equal(braceV1!.majorScope, 1);
assert.equal(braceV1!.floor, "1.1.18");

const braceV5 = overrides.find((o) => o.key === "brace-expansion@^5");
assert.ok(braceV5, "brace-expansion@^5 override should be detected");
assert.equal(braceV5!.majorScope, 5);
assert.equal(braceV5!.floor, "5.0.9");

// ---------------------------------------------------------------------------
// parseResolvedVersions
// ---------------------------------------------------------------------------

const SAMPLE_LOCKFILE = `
lockfileVersion: '9.0'

snapshots:
  dompurify@3.4.12:
    dependencies:
      foo: 1.0.0

  'fast-uri@3.1.5':
    dependencies: {}

  'fast-uri@3.2.0(@ajv@8.17.1)':
    dependencies: {}

  brace-expansion@1.1.18:
    dependencies: {}

  brace-expansion@5.0.9:
    dependencies: {}

  brace-expansion@5.1.0:
    dependencies: {}

  '@scoped/package@1.2.3':
    dependencies: {}
`;

const resolved = parseResolvedVersions(SAMPLE_LOCKFILE);

const names = resolved.map((r) => `${r.packageName}@${r.version}`);
assert.ok(names.includes("dompurify@3.4.12"), "should find dompurify@3.4.12");
assert.ok(names.includes("fast-uri@3.1.5"), "should find fast-uri@3.1.5");
assert.ok(names.includes("fast-uri@3.2.0"), "should find fast-uri@3.2.0 (peer-dep suffix stripped)");
assert.ok(names.includes("brace-expansion@1.1.18"), "should find brace-expansion@1.1.18");
assert.ok(names.includes("brace-expansion@5.0.9"), "should find brace-expansion@5.0.9");
assert.ok(names.includes("brace-expansion@5.1.0"), "should find brace-expansion@5.1.0");
assert.ok(names.includes("@scoped/package@1.2.3"), "should find scoped package");

// ---------------------------------------------------------------------------
// checkOverrides
// ---------------------------------------------------------------------------

const sampleOverrides = parseSecurityOverrides(SAMPLE_WORKSPACE);
const sampleResolved = parseResolvedVersions(SAMPLE_LOCKFILE);
const results = checkOverrides(sampleOverrides, sampleResolved);

// dompurify resolved at exactly the floor → active (not a warning)
const domResult = results.find((r) => r.override.key === "dompurify");
assert.ok(domResult, "should have a result for dompurify");
assert.equal(domResult!.aboveFloor.length, 0, "dompurify@3.4.12 == floor → not above floor");
assert.equal(domResult!.allAtFloor, true, "dompurify should be allAtFloor");

// fast-uri has two versions: 3.1.5 (== floor) and 3.2.0 (> floor) → warning
const fastUriResult = results.find((r) => r.override.key === "fast-uri");
assert.ok(fastUriResult, "should have a result for fast-uri");
assert.ok(fastUriResult!.aboveFloor.includes("3.2.0"), "fast-uri@3.2.0 should be flagged as above floor");

// adm-zip not in lockfile → notInstalled
const admZipResult = results.find((r) => r.override.key === "adm-zip");
assert.ok(admZipResult, "should have a result for adm-zip");
assert.equal(admZipResult!.notInstalled, true, "adm-zip should be notInstalled");

// brace-expansion@^1 → only 1.x; resolved 1.1.18 == floor → active
const braceV1Result = results.find((r) => r.override.key === "brace-expansion@^1");
assert.ok(braceV1Result, "should have a result for brace-expansion@^1");
assert.equal(braceV1Result!.aboveFloor.length, 0, "brace-expansion 1.1.18 == floor");

// brace-expansion@^5 → only 5.x; resolved 5.0.9 == floor AND 5.1.0 > floor → warning
const braceV5Result = results.find((r) => r.override.key === "brace-expansion@^5");
assert.ok(braceV5Result, "should have a result for brace-expansion@^5");
assert.ok(braceV5Result!.aboveFloor.includes("5.1.0"), "brace-expansion@5.1.0 should be flagged");
// 5.0.9 is == floor, so not in aboveFloor
assert.ok(!braceV5Result!.aboveFloor.includes("5.0.9"), "brace-expansion@5.0.9 should NOT be flagged");

console.log("✓ check-stale-overrides: all assertions passed");
