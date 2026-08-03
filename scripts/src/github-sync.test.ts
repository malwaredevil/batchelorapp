/**
 * github-sync.test.ts
 *
 * Regression tests for the isExcluded() carve-out logic in github-sync.ts,
 * specifically the `.replit-artifact/` narrow exception that allows
 * artifact.toml through while blocking everything else in that directory.
 *
 * Run: tsx ./src/github-sync.test.ts
 */
import assert from "node:assert/strict";
import { isExcluded } from "./github-sync.js";

// ---------------------------------------------------------------------------
// .replit-artifact/ carve-out
// ---------------------------------------------------------------------------

// artifact.toml is the ONLY file allowed through .replit-artifact/
assert.equal(
  isExcluded(".replit-artifact/artifact.toml"),
  false,
  ".replit-artifact/artifact.toml must NOT be excluded (needed for registry)",
);

// Every other file under .replit-artifact/ must be excluded
assert.equal(
  isExcluded(".replit-artifact/other-file.txt"),
  true,
  "other files under .replit-artifact/ must be excluded",
);
assert.equal(
  isExcluded(".replit-artifact/secrets.env"),
  true,
  "secret-like files under .replit-artifact/ must be excluded",
);
assert.equal(
  isExcluded(".replit-artifact/config.json"),
  true,
  "config.json under .replit-artifact/ must be excluded",
);

// Nested paths — .replit-artifact/ can appear at any depth in the tree
assert.equal(
  isExcluded("artifacts/web/.replit-artifact/artifact.toml"),
  false,
  "nested .replit-artifact/artifact.toml must NOT be excluded",
);
assert.equal(
  isExcluded("artifacts/web/.replit-artifact/other.json"),
  true,
  "nested .replit-artifact/ non-toml files must be excluded",
);
assert.equal(
  isExcluded("artifacts/api-server/.replit-artifact/secrets.txt"),
  true,
  "nested .replit-artifact/ secret-like files must be excluded",
);

// ---------------------------------------------------------------------------
// .replit itself stays fully excluded (separate EXCLUDED_EXACT entry)
// ---------------------------------------------------------------------------
assert.equal(isExcluded(".replit"), true, ".replit must always be excluded");
assert.equal(
  isExcluded(".replitignore"),
  true,
  ".replitignore must always be excluded",
);
assert.equal(
  isExcluded("replit.nix"),
  true,
  "replit.nix must always be excluded",
);

// ---------------------------------------------------------------------------
// Normal files are not excluded by the carve-out
// ---------------------------------------------------------------------------
assert.equal(
  isExcluded("src/index.ts"),
  false,
  "normal source files must not be excluded",
);
assert.equal(
  isExcluded("artifacts/web/src/App.tsx"),
  false,
  "normal artifact source files must not be excluded",
);

// ---------------------------------------------------------------------------
// Other exclusion rules are not accidentally broken by the carve-out
// ---------------------------------------------------------------------------
assert.equal(
  isExcluded(".agents/memory/foo.md"),
  true,
  ".agents/ must still be excluded",
);
assert.equal(
  isExcluded(".local/skills/foo/SKILL.md"),
  true,
  ".local/ must still be excluded",
);
assert.equal(
  isExcluded("threat_model.md"),
  true,
  "threat_model.md must still be excluded",
);

console.log("✓ github-sync isExcluded tests passed");
