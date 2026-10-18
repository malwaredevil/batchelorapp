import fs from "node:fs";
import path from "node:path";
import type { PrivacyFinding } from "./hounddog-report.js";

// HoundDog's built-in excludes include directories named "artifacts".
// Preserve depth and relative imports, but never stage that ignored name.
export function scannerPath(file: string): string {
  return file
    .replace(/^artifacts\//, "applications/")
    .replace(/^apify-actors\//, "actors/");
}

export const CANARY_SOURCE = `import express from "express";
const app = express();
app.post("/canary", (req, res) => {
  const email = req.body.email;
  const password = req.body.password;
  console.log("Contact:", email);
  console.log("Credential:", password);
  res.json({ ok: true });
});
`;

export function requireCanary(findings: PrivacyFinding[], file: string): void {
  const flows = findings.filter((f) => f.file === file && f.sink === "stdout");
  if (
    !flows.some(
      (f) => f.types.includes("password") && f.severity === "critical",
    ) ||
    !flows.some((f) => f.types.includes("email"))
  ) {
    throw new Error(`Missing positive privacy coverage probe: ${file}`);
  }
}

export function writeScopeProbes(source: string, files: string[]): string[] {
  const groups = new Set(
    files.flatMap((file) => {
      const match = /^(artifacts|apify-actors)\/([^/]+)\//.exec(file);
      return match ? [scannerPath(`${match[1]}/${match[2]}/`)] : [];
    }),
  );
  if (![...groups].some((group) => group.startsWith("applications/"))) {
    throw new Error("No application source in the privacy inventory.");
  }
  return [...groups].map((group) => {
    const jsx = files.some(
      (file) => scannerPath(file).startsWith(group) && file.endsWith(".tsx"),
    );
    const relative = `${group}src/privacy_scope_probe.${jsx ? "tsx" : "ts"}`;
    const target = path.join(source, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      target,
      CANARY_SOURCE + (jsx ? "\nconst scopeProbe = <span>probe</span>;\n" : ""),
      { flag: "wx", mode: 0o600 },
    );
    return relative;
  });
}

/** Probe findings prove inclusion; real occurrences prove this isn't probe-only. */
export function verifySourceCoverage(
  report: unknown,
  findings: PrivacyFinding[],
  probes: string[],
  stagedFiles: Set<string>,
): { filesWithOccurrences: number; applicationFilesWithOccurrences: number } {
  for (const probe of probes) requireCanary(findings, probe);
  const data = report as Record<string, unknown>;
  const seen = new Set<string>();
  for (const key of ["data_element_occurrences", "data_sink_occurrences"]) {
    const occurrences = data[key];
    if (!Array.isArray(occurrences))
      throw new Error("Missing coverage inventory.");
    for (const value of occurrences) {
      if (!value || typeof value !== "object" || !("code_segment" in value))
        throw new Error("Invalid coverage occurrence.");
      const segment = value.code_segment;
      if (
        !segment ||
        typeof segment !== "object" ||
        !("rel_file_path" in segment)
      )
        throw new Error("Invalid coverage location.");
      const file = segment.rel_file_path;
      if (typeof file !== "string") throw new Error("Invalid coverage path.");
      if (stagedFiles.has(file)) seen.add(file);
    }
  }
  const applicationFiles = [...seen].filter((file) =>
    file.startsWith("applications/"),
  ).length;
  if (!applicationFiles) {
    throw new Error("No real application occurrences; refusing a clean scan.");
  }
  return {
    filesWithOccurrences: seen.size,
    applicationFilesWithOccurrences: applicationFiles,
  };
}
