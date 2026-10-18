import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shouldScanFile } from "../pii-scan.js";
import {
  CANARY_SOURCE,
  requireCanary,
  scannerPath,
  verifySourceCoverage,
  writeScopeProbes,
} from "./hounddog-coverage.js";
import {
  ensureHounddog,
  HOUNDDOG_RELEASE,
  scanDirectory,
} from "./hounddog-tool.js";
import {
  parseHounddogReport,
  requiresPrivacyReview,
  SEVERITIES,
} from "./hounddog-report.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".sql",
]);
/** Reuses exclusions except the legacy whole-actor exclusion: actors ship too. */
export function sourceFiles(root: string): string[] {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return [...new Set(listed.split("\0").filter(Boolean))]
    .filter((file) => {
      const publicPath = file.replace(/^apify-actors\//, "actors/");
      if (
        !shouldScanFile(publicPath) ||
        !SOURCE_EXTENSIONS.has(path.extname(file))
      )
        return false;
      try {
        return fs.lstatSync(path.join(root, file)).isFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    })
    .sort();
}

function fingerprint(
  root: string,
  files: string[],
  destination?: string,
): string {
  const hash = createHash("sha256");
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(root, file));
    hash.update(file).update("\0").update(bytes);
    if (destination) {
      const target = path.join(destination, scannerPath(file));
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, bytes, { mode: 0o600 });
    }
  }
  return hash.digest("hex");
}

async function main(): Promise<number> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.some((arg) => !["--install", "--report-only"].includes(arg))) {
    throw new Error("Usage: privacy:scan [--report-only] or privacy:install");
  }
  const binary = await ensureHounddog(ROOT);
  if (args.includes("--install")) {
    console.log(
      `HoundDog ${HOUNDDOG_RELEASE.version} installed and checksum verified.`,
    );
    return 0;
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "batchelor-privacy-"));
  const reports = path.join(ROOT, "generated-artifacts/security/hounddog");
  fs.mkdirSync(reports, { recursive: true, mode: 0o700 });
  try {
    const canary = path.join(scratch, "canary");
    fs.mkdirSync(canary, { mode: 0o700 });
    fs.writeFileSync(path.join(canary, "canary.ts"), CANARY_SOURCE, {
      mode: 0o600,
    });
    const canaryReport = path.join(scratch, "canary.json");
    scanDirectory(
      binary,
      canary,
      canaryReport,
      path.join(scratch, "canary-home"),
    );
    const detected = parseHounddogReport(
      JSON.parse(fs.readFileSync(canaryReport, "utf8")),
      new Set(["canary.ts"]),
    );
    requireCanary(detected, "canary.ts");
    const files = sourceFiles(ROOT);
    if (!files.length)
      throw new Error("No source files selected; refusing a clean result.");
    const source = path.join(scratch, "source");
    const originalPaths = new Map(
      files.map((file) => [scannerPath(file), file]),
    );
    if (originalPaths.size !== files.length)
      throw new Error("Scanner path mapping collision.");
    const digest = fingerprint(ROOT, files, source);
    const probes = writeScopeProbes(source, files);
    const temporaryReport = path.join(scratch, "repository.json");
    scanDirectory(
      binary,
      source,
      temporaryReport,
      path.join(scratch, "scan-home"),
    );
    const raw = fs.readFileSync(temporaryReport, "utf8");
    // Preserve failure evidence privately; only a validated summary is success.
    fs.writeFileSync(path.join(reports, "latest.json"), raw, { mode: 0o600 });
    const parsedRaw: unknown = JSON.parse(raw);
    const stagedFiles = new Set(originalPaths.keys());
    const detectedFlows = parseHounddogReport(
      parsedRaw,
      new Set([...stagedFiles, ...probes]),
    );
    const coverage = verifySourceCoverage(
      parsedRaw,
      detectedFlows,
      probes,
      stagedFiles,
    );
    const findings = detectedFlows
      .filter((finding) => !probes.includes(finding.file))
      .map((finding) => {
        const file = originalPaths.get(finding.file);
        if (!file) throw new Error("Finding outside the source manifest.");
        return { ...finding, file };
      });
    if (
      JSON.stringify(files) !== JSON.stringify(sourceFiles(ROOT)) ||
      digest !== fingerprint(ROOT, files)
    ) {
      throw new Error(
        "Source changed during the privacy scan; rerun before publishing.",
      );
    }
    const counts = Object.fromEntries(
      SEVERITIES.map((severity) => [
        severity,
        findings.filter((f) => f.severity === severity).length,
      ]),
    );
    const reviewRequired = requiresPrivacyReview(findings);
    fs.writeFileSync(
      path.join(reports, "summary.json"),
      JSON.stringify(
        {
          status: reviewRequired ? "review_required" : "scanned",
          version: HOUNDDOG_RELEASE.version,
          sourceSha256: digest,
          sourceFilesStaged: files.length,
          scopeProbesPassed: probes.length,
          coverage,
          generatedAt: new Date().toISOString(),
          counts,
          findings,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    console.log(
      `HoundDog ${HOUNDDOG_RELEASE.version}: canary and ${probes.length} scope probes passed; ${files.length} source files staged; ${coverage.applicationFilesWithOccurrences} real application files have observed occurrences.`,
    );
    console.log(
      `Dataflows: ${JSON.stringify(counts)}. Private reports: generated-artifacts/security/hounddog/`,
    );
    if (reviewRequired) {
      console.error(
        "Privacy review required: critical/medium findings block the release gate.",
      );
      // Locations only: no source snippets, PII values, or provider error output.
      for (const finding of findings.filter(
        (f) => f.severity === "critical" || f.severity === "medium",
      )) {
        console.error(`${finding.severity}: ${finding.file}:${finding.line}`);
      }
    }
    return reviewRequired && !args.includes("--report-only") ? 1 : 0;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      // Invalidate earlier success evidence even if install/parse/canary failed.
      fs.rmSync(
        path.join(ROOT, "generated-artifacts/security/hounddog/summary.json"),
        { force: true },
      );
      console.error(
        "HoundDog scanner error: coverage unavailable. No clean result accepted.",
      );
      process.exitCode = 2;
    },
  );
}
