import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GENERATED_DIR, ROOT } from "./utils";
import "./generate";

const SECRET_RE =
  /(postgres:\/\/|postgresql:\/\/|eyJ[a-zA-Z0-9_-]{40,}|sk-[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9_]{20,})/i;

for (const file of fs.readdirSync(GENERATED_DIR)) {
  const full = path.join(GENERATED_DIR, file);
  if (fs.statSync(full).isFile() && SECRET_RE.test(fs.readFileSync(full, "utf8"))) {
    throw new Error(`Generated docs may contain a secret-like value: ${file}`);
  }
}

try {
  execFileSync("git", ["diff", "--quiet", "--", "docs/generated"], {
    cwd: ROOT,
    stdio: "pipe",
  });
} catch {
  console.error(
    "Generated documentation is out of date. Run pnpm --filter @workspace/scripts run docs:generate and commit the result.",
  );
  execFileSync("git", ["--no-pager", "diff", "--stat", "--", "docs/generated"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  process.exit(1);
}

console.log("Generated documentation is up to date.");
