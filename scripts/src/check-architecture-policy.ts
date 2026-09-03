/**
 * Architecture policy guard.
 *
 * This is the no-net-new-debt layer over the focused architecture checks. The
 * focused checks remain the source of truth for detection; this script adds
 * snapshot comparison, reviewed-baseline accounting, and one deterministic
 * report for agents and CI.
 *
 * A finding identity deliberately excludes line numbers. Moving a function
 * must not turn an old finding into a new one, while changing its evidence or
 * adding a second occurrence remains visible as a new/worsened result.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run check-architecture-policy -- --base origin/main
 *   pnpm --filter @workspace/scripts run check-architecture-policy -- --write-baseline
 *   pnpm --filter @workspace/scripts run check-architecture-policy -- --write-report
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  checkHardcodedConfigFromFiles,
  type HardcodedConfigViolation,
} from "./check-hardcoded-config.js";
import {
  checkDuplicateCodeAudit,
  duplicateAllowlistKey,
  DUPLICATE_CODE_ALLOWLIST,
  DUPLICATE_CODE_EXCEPTION_REASONS,
  type DuplicateViolation,
} from "./check-duplicate-code.js";
import {
  git,
  readFileOrNull,
  repoRoot,
  resolveBase,
  walkFiles,
} from "./lib/git-diff-utils.js";

export const BASELINE_PATH = "docs/architecture-policy-baseline.json";
export const REPORT_PATH = "docs/architecture-policy-report.md";

export const ARCHITECTURE_CATEGORIES = [
  "duplicate-code",
  "hardcoded-config",
] as const;
export type ArchitectureCategory = (typeof ARCHITECTURE_CATEGORIES)[number];

export interface ArchitectureFinding {
  id: string;
  category: ArchitectureCategory;
  file: string;
  symbol: string;
  evidence: string;
  metric: number;
}

export interface ArchitectureException {
  id: string;
  category: ArchitectureCategory;
  file: string;
  evidence: string;
  reason: string;
  metric: number;
}

export interface ArchitectureBaseline {
  version: 1;
  findings: ArchitectureFinding[];
  exceptions: ArchitectureException[];
}

export interface ArchitectureSnapshot {
  findings: ArchitectureFinding[];
  exceptions: ArchitectureException[];
}

export interface ArchitecturePolicyReport {
  newFindings: ArchitectureFinding[];
  worsenedFindings: Array<{
    before: ArchitectureFinding;
    after: ArchitectureFinding;
  }>;
  unchangedLegacyFindings: ArchitectureFinding[];
  relatedLegacyFindings: ArchitectureFinding[];
  removedFindings: ArchitectureFinding[];
  undocumentedHistoricalFindings: ArchitectureFinding[];
  undocumentedExceptions: ArchitectureException[];
  worsenedExceptions: Array<{
    before: ArchitectureException;
    after: ArchitectureException;
  }>;
  baselineAdded: string[];
  baselineRemoved: string[];
  exceptionAdded: string[];
  exceptionRemoved: string[];
  blockingReasons: string[];
  contractChecks: Array<{ name: string; passed: boolean; output: string }>;
}

function findingId(
  category: ArchitectureCategory,
  file: string,
  symbol: string,
  evidence: string,
): string {
  return `${category}:${file}:${symbol}:${evidence}`;
}

function duplicateFinding(violation: DuplicateViolation): ArchitectureFinding {
  const evidence = `${violation.matchFile}:${violation.matchName}`;
  return {
    id: findingId("duplicate-code", violation.file, violation.name, evidence),
    category: "duplicate-code",
    file: violation.file,
    symbol: violation.name,
    evidence,
    metric: violation.similarity,
  };
}

function hardcodedFinding(
  violation: HardcodedConfigViolation,
): ArchitectureFinding {
  const evidence = `${violation.kind}:${[...violation.names].sort().join(",")}:${violation.context}`;
  return {
    id: findingId("hardcoded-config", violation.file, violation.kind, evidence),
    category: "hardcoded-config",
    file: violation.file,
    symbol: violation.kind,
    evidence,
    metric: violation.names.length,
  };
}

function duplicateException(
  violation: DuplicateViolation,
): ArchitectureException {
  const finding = duplicateFinding(violation);
  return {
    id: `exception:${finding.id}`,
    category: "duplicate-code",
    file: finding.file,
    evidence: finding.evidence,
    reason:
      DUPLICATE_CODE_EXCEPTION_REASONS.get(duplicateAllowlistKey(violation)) ??
      "",
    metric: 1,
  };
}

function hardcodedException(
  violation: HardcodedConfigViolation,
): ArchitectureException {
  const finding = hardcodedFinding(violation);
  return {
    id: `exception:${finding.id}`,
    category: "hardcoded-config",
    file: finding.file,
    evidence: finding.evidence,
    reason: `The focused hardcoded-config guard separately reviews the fixed ${violation.kind} expression with ${violation.names.join(", ")} in ${violation.context}.`,
    metric: 1,
  };
}

function sortedUnique<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()].sort(
    (a, b) => a.id.localeCompare(b.id),
  );
}

function sortedExceptions(
  items: ArchitectureException[],
): ArchitectureException[] {
  const grouped = new Map<string, ArchitectureException>();
  for (const exception of items) {
    const existing = grouped.get(exception.id);
    if (existing) existing.metric += exception.metric;
    else grouped.set(exception.id, { ...exception });
  }
  return [...grouped.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function snapshotFromViolations(
  duplicateViolations: DuplicateViolation[],
  hardcodedViolations: HardcodedConfigViolation[],
): ArchitectureSnapshot {
  const findings = [
    ...duplicateViolations
      .filter(
        (violation) =>
          !DUPLICATE_CODE_ALLOWLIST.has(duplicateAllowlistKey(violation)),
      )
      .map(duplicateFinding),
    ...hardcodedViolations
      .filter((violation) => !violation.allowlisted)
      .map(hardcodedFinding),
  ];

  const exceptions = [
    ...duplicateViolations
      .filter((violation) =>
        DUPLICATE_CODE_ALLOWLIST.has(duplicateAllowlistKey(violation)),
      )
      .map(duplicateException),
    ...hardcodedViolations
      .filter((violation) => violation.allowlisted)
      .map(hardcodedException),
  ];

  return {
    findings: sortedUnique(findings),
    exceptions: sortedExceptions(exceptions),
  };
}

export function classifyArchitectureFindings(
  base: ArchitectureSnapshot,
  current: ArchitectureSnapshot,
  baseline: ArchitectureBaseline,
  changedFiles: string[],
  options: {
    baselineExistsAtBase?: boolean;
    baselineAtBase?: ArchitectureBaseline;
  } = {},
): ArchitecturePolicyReport {
  const baseById = new Map(
    base.findings.map((finding) => [finding.id, finding]),
  );
  const currentById = new Map(
    current.findings.map((finding) => [finding.id, finding]),
  );
  const baselineById = new Map(
    baseline.findings.map((finding) => [finding.id, finding]),
  );
  const baselineExceptionIds = new Set(
    baseline.exceptions.map((exception) => exception.id),
  );

  const newFindings: ArchitectureFinding[] = [];
  const worsenedFindings: Array<{
    before: ArchitectureFinding;
    after: ArchitectureFinding;
  }> = [];
  const unchangedLegacyFindings: ArchitectureFinding[] = [];
  const relatedLegacyFindings: ArchitectureFinding[] = [];
  const undocumentedHistoricalFindings: ArchitectureFinding[] = [];

  for (const finding of current.findings) {
    const before = baseById.get(finding.id);
    const reviewed = baselineById.has(finding.id);
    if (!before) {
      newFindings.push(finding);
    } else if (finding.metric > before.metric) {
      worsenedFindings.push({ before, after: finding });
    } else if (reviewed) {
      unchangedLegacyFindings.push(finding);
      if (changedFiles.includes(finding.file)) {
        relatedLegacyFindings.push(finding);
      }
    } else {
      undocumentedHistoricalFindings.push(finding);
    }
  }

  const removedFindings = base.findings.filter(
    (finding) => !currentById.has(finding.id),
  );
  const undocumentedExceptions = current.exceptions.filter(
    (exception) => !baselineExceptionIds.has(exception.id),
  );
  const baseExceptionById = new Map(
    base.exceptions.map((exception) => [exception.id, exception]),
  );
  const worsenedExceptions = current.exceptions
    .flatMap((after) => {
      const before = baseExceptionById.get(after.id);
      return before && after.metric > before.metric ? [{ before, after }] : [];
    })
    .sort((a, b) => a.after.id.localeCompare(b.after.id));
  const baseBaselineIds = new Set(
    options.baselineAtBase?.findings.map((finding) => finding.id) ?? [],
  );
  const baseBaselineExceptionIds = new Set(
    options.baselineAtBase?.exceptions.map((exception) => exception.id) ?? [],
  );
  const baselineAdded = baseline.findings
    .filter((finding) => !baseBaselineIds.has(finding.id))
    .map((finding) => finding.id)
    .sort();
  const baselineRemoved = [...baseBaselineIds]
    .filter((id) => !baselineById.has(id))
    .sort();
  const exceptionAdded = baseline.exceptions
    .filter((exception) => !baseBaselineExceptionIds.has(exception.id))
    .map((exception) => exception.id)
    .sort();
  const exceptionRemoved = [...baseBaselineExceptionIds]
    .filter((id) => !baselineExceptionIds.has(id))
    .sort();

  const implementationChanged = changedFiles.some(isImplementationFile);
  const blockingReasons: string[] = [];
  if (newFindings.length > 0) {
    blockingReasons.push(`${newFindings.length} new architectural finding(s)`);
  }
  if (worsenedFindings.length > 0) {
    blockingReasons.push(
      `${worsenedFindings.length} worsened architectural finding(s)`,
    );
  }
  if (undocumentedHistoricalFindings.length > 0) {
    blockingReasons.push(
      `${undocumentedHistoricalFindings.length} historical finding(s) are missing from the reviewed baseline`,
    );
  }
  if (undocumentedExceptions.length > 0) {
    blockingReasons.push(
      `${undocumentedExceptions.length} exception(s) are missing from the reviewed baseline`,
    );
  }
  if (worsenedExceptions.length > 0) {
    blockingReasons.push(
      `${worsenedExceptions.length} exception finding(s) became more numerous`,
    );
  }

  // A baseline-only maintenance PR is reviewable. A baseline expansion made
  // alongside implementation changes is not: it could disguise the very
  // finding introduced by that change. The first baseline is allowed to
  // record findings already present at the merge base, but not new findings.
  const initialBaseline =
    options.baselineExistsAtBase === false &&
    baselineAdded.every((id) => baseById.has(id)) &&
    exceptionAdded.every((id) =>
      base.exceptions.some((exception) => exception.id === id),
    );
  if (baselineAdded.length > 0 && implementationChanged && !initialBaseline) {
    blockingReasons.push(
      "reviewed baseline expanded in the same change as implementation code; use a separate baseline-maintenance change",
    );
  }
  if (
    baselineAdded.some((id) => newFindings.some((finding) => finding.id === id))
  ) {
    blockingReasons.push(
      "baseline expansion attempts to hide a finding introduced by the current change",
    );
  }
  if (baselineAdded.some((id) => !currentById.has(id))) {
    blockingReasons.push(
      "baseline expansion contains a finding that is not present in the audited working tree",
    );
  }
  const exceptionsObservableAtBase = exceptionAdded.filter((id) => {
    const findingId = id.startsWith("exception:")
      ? id.slice("exception:".length)
      : id;
    return baseBaselineExceptionIds.has(id) || baseById.has(findingId);
  });
  if (
    exceptionsObservableAtBase.length > 0 &&
    implementationChanged &&
    !initialBaseline
  ) {
    blockingReasons.push(
      "reviewed exception list expanded in the same change as implementation code; use a separate exception-maintenance change",
    );
  }
  if (
    exceptionAdded.some(
      (id) => !current.exceptions.some((exception) => exception.id === id),
    )
  ) {
    blockingReasons.push(
      "exception list expansion contains an exception that is not present in the audited working tree",
    );
  }

  return {
    newFindings: newFindings.sort((a, b) => a.id.localeCompare(b.id)),
    worsenedFindings: worsenedFindings.sort((a, b) =>
      a.after.id.localeCompare(b.after.id),
    ),
    unchangedLegacyFindings: unchangedLegacyFindings.sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    relatedLegacyFindings: relatedLegacyFindings.sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    removedFindings: removedFindings.sort((a, b) => a.id.localeCompare(b.id)),
    undocumentedHistoricalFindings: undocumentedHistoricalFindings.sort(
      (a, b) => a.id.localeCompare(b.id),
    ),
    undocumentedExceptions: undocumentedExceptions.sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    worsenedExceptions,
    baselineAdded,
    baselineRemoved,
    exceptionAdded,
    exceptionRemoved,
    blockingReasons,
    contractChecks: [],
  };
}

function isImplementationFile(file: string): boolean {
  return (
    /^(artifacts|lib)\//.test(file) &&
    /\.(ts|tsx|yaml|yml)$/.test(file) &&
    !file.endsWith(".generated.ts")
  );
}

function listSourceFiles(root: string): string[] {
  return [
    ...walkFiles(path.join(root, "artifacts"), [".ts", ".tsx"]),
    ...walkFiles(path.join(root, "lib"), [".ts", ".tsx"]),
  ]
    .map((file) => path.relative(root, file))
    .sort();
}

function listSourceFilesAtRef(root: string, ref: string): string[] {
  return git(root, ["ls-tree", "-r", "--name-only", ref])
    .split("\n")
    .map((file) => file.trim())
    .filter(
      (file) => /^(artifacts|lib)\//.test(file) && /\.(ts|tsx)$/.test(file),
    )
    .sort();
}

function readAtRef(root: string, ref: string, file: string): string | null {
  try {
    return execFileSync("git", ["-C", root, "show", `${ref}:${file}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024 * 128,
    });
  } catch {
    return null;
  }
}

function loadBaseline(filePath: string): ArchitectureBaseline {
  if (!fs.existsSync(filePath)) {
    return { version: 1, findings: [], exceptions: [] };
  }
  const parsed = JSON.parse(
    fs.readFileSync(filePath, "utf8"),
  ) as Partial<ArchitectureBaseline>;
  if (parsed.version !== 1 || !Array.isArray(parsed.findings)) {
    throw new Error(
      `${BASELINE_PATH} must be version 1 with a findings array; do not edit its shape silently.`,
    );
  }
  if (!Array.isArray(parsed.exceptions)) {
    throw new Error(`${BASELINE_PATH} must contain an exceptions array.`);
  }
  return {
    version: 1,
    findings: sortedUnique(parsed.findings),
    exceptions: sortedUnique(parsed.exceptions),
  };
}

function validateBaseline(baseline: ArchitectureBaseline): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const finding of baseline.findings) {
    if (ids.has(finding.id))
      errors.push(`duplicate baseline finding: ${finding.id}`);
    ids.add(finding.id);
    if (!ARCHITECTURE_CATEGORIES.includes(finding.category)) {
      errors.push(`invalid baseline category: ${finding.id}`);
    }
    if (!finding.file || finding.file.includes("*")) {
      errors.push(`baseline finding must name one stable file: ${finding.id}`);
    }
    if (!finding.symbol || !finding.evidence) {
      errors.push(
        `baseline finding must name one stable symbol and evidence: ${finding.id}`,
      );
    }
  }
  const exceptionIds = new Set<string>();
  for (const exception of baseline.exceptions) {
    if (exceptionIds.has(exception.id)) {
      errors.push(`duplicate baseline exception: ${exception.id}`);
    }
    exceptionIds.add(exception.id);
    if (!exception.reason?.trim()) {
      errors.push(`baseline exception needs a reason: ${exception.id}`);
    }
    if (!exception.file || exception.file.includes("*")) {
      errors.push(
        `baseline exception must name one stable file: ${exception.id}`,
      );
    }
    if (!exception.evidence) {
      errors.push(
        `baseline exception must name one stable finding identity: ${exception.id}`,
      );
    }
  }
  return errors;
}

function snapshotCurrent(root: string): ArchitectureSnapshot {
  const files = listSourceFiles(root);
  const duplicateViolations = checkDuplicateCodeAudit(files, (file) =>
    readFileOrNull(root, file),
  );
  const hardcodedViolations = checkHardcodedConfigFromFiles(
    files,
    (file) => readFileOrNull(root, file),
    undefined,
    true,
  );
  return snapshotFromViolations(duplicateViolations, hardcodedViolations);
}

function snapshotAtRef(root: string, ref: string): ArchitectureSnapshot {
  const files = listSourceFilesAtRef(root, ref);
  const read = (file: string) => readAtRef(root, ref, file);
  return snapshotFromViolations(
    checkDuplicateCodeAudit(files, read),
    checkHardcodedConfigFromFiles(files, read, undefined, true),
  );
}

function runContractCheck(
  root: string,
  name: string,
  command: string,
  args: string[],
): { name: string; passed: boolean; output: string } {
  try {
    const output = execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024 * 8,
    });
    return { name, passed: true, output: output.trim() };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    return {
      name,
      passed: false,
      output: `${failed.stdout ?? ""}${failed.stderr ?? ""}`.trim(),
    };
  }
}

function runContractChecks(root: string, base: string) {
  return [
    runContractCheck(root, "scaffold and safety contracts", "pnpm", [
      "--filter",
      "@workspace/scripts",
      "run",
      "check-guardrails",
      "--",
      "--base",
      base,
    ]),
    runContractCheck(root, "shared composition boundaries", "pnpm", [
      "--filter",
      "@workspace/scripts",
      "run",
      "check-domain-composition",
    ]),
    runContractCheck(root, "shared application shell", "pnpm", [
      "--filter",
      "@workspace/scripts",
      "run",
      "check-app-shell",
    ]),
    runContractCheck(root, "Elaine capability parity", "pnpm", [
      "--filter",
      "@workspace/scripts",
      "run",
      "elaine:capability-parity",
    ]),
    runContractCheck(root, "Elaine operation catalog", "pnpm", [
      "--filter",
      "@workspace/scripts",
      "run",
      "elaine:operation-catalog",
    ]),
  ];
}

function baselineAtRef(
  root: string,
  ref: string,
): { baseline: ArchitectureBaseline; exists: boolean } {
  const raw = readAtRef(root, ref, BASELINE_PATH);
  if (raw === null) {
    return {
      baseline: { version: 1, findings: [], exceptions: [] },
      exists: false,
    };
  }
  const parsed = JSON.parse(raw) as ArchitectureBaseline;
  return { baseline: parsed, exists: true };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function renderReport(
  report: ArchitecturePolicyReport,
  current: ArchitectureSnapshot,
): string {
  const section = (title: string, items: string[]) =>
    `## ${title}\n\n${items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "_None._"}\n`;
  const findingLabel = (finding: ArchitectureFinding) =>
    `\`${finding.id}\` (${finding.file}, ${finding.symbol})`;
  const contractLines = report.contractChecks.map(
    (check) => `- ${check.passed ? "PASS" : "FAIL"} — ${check.name}`,
  );
  const prioritizedLegacy = [...report.unchangedLegacyFindings]
    .sort((a, b) => b.metric - a.metric || a.id.localeCompare(b.id))
    .slice(0, 25);
  const exceptionPreview = current.exceptions.slice(0, 20);
  return `# Architecture policy report

Generated by \`check-architecture-policy\`; do not edit by hand.

The policy is no-net-new-debt: new and worsened findings fail, unchanged
reviewed legacy findings remain visible, and baseline maintenance is separate
from implementation changes.

## Summary

- New findings: ${report.newFindings.length}
- Worsened findings: ${report.worsenedFindings.length}
- Unchanged legacy findings: ${report.unchangedLegacyFindings.length}
- Related legacy findings in touched files: ${report.relatedLegacyFindings.length}
- Findings removed by the current snapshot: ${report.removedFindings.length}
- Undocumented historical findings: ${report.undocumentedHistoricalFindings.length}
- Documented exceptions: ${current.exceptions.length}
- Undocumented exceptions: ${report.undocumentedExceptions.length}
- Baseline additions: ${report.baselineAdded.length}
- Exception additions: ${report.exceptionAdded.length}

${section("New findings (blocking)", report.newFindings.map(findingLabel))}
${section(
  "Worsened findings (blocking)",
  report.worsenedFindings.map(
    ({ after, before }) =>
      `${findingLabel(after)} — metric ${before.metric} → ${after.metric}`,
  ),
)}
${section(
  "Related legacy findings — best effort required",
  report.relatedLegacyFindings.map(findingLabel),
)}
${section(
  "Prioritized legacy cleanup candidates",
  prioritizedLegacy.map(
    (finding) => `${findingLabel(finding)} — detector metric ${finding.metric}`,
  ),
)}
${section(
  "Findings removed by this change",
  report.removedFindings.map(findingLabel),
)}
${section(
  "Undocumented historical findings (blocking until reviewed)",
  report.undocumentedHistoricalFindings.map(findingLabel),
)}
${section("Documented exceptions", [
  ...exceptionPreview.map(
    (exception) => `\`${exception.id}\` — ${exception.reason}`,
  ),
  ...(current.exceptions.length > exceptionPreview.length
    ? [
        `… ${current.exceptions.length - exceptionPreview.length} additional narrowly scoped exceptions are recorded in \`${BASELINE_PATH}\`.`,
      ]
    : []),
])}
${section("Baseline changes", [
  ...report.baselineAdded.slice(0, 20).map((id) => `Added: \`${id}\``),
  ...(report.baselineAdded.length > 20
    ? [`… ${report.baselineAdded.length - 20} additional reviewed additions.`]
    : []),
  ...report.baselineRemoved.slice(0, 20).map((id) => `Removed: \`${id}\``),
  ...(report.baselineRemoved.length > 20
    ? [`… ${report.baselineRemoved.length - 20} additional removals.`]
    : []),
  ...report.exceptionAdded
    .slice(0, 20)
    .map((id) => `Exception added: \`${id}\``),
  ...(report.exceptionAdded.length > 20
    ? [
        `… ${report.exceptionAdded.length - 20} additional reviewed exception additions.`,
      ]
    : []),
  ...report.exceptionRemoved
    .slice(0, 20)
    .map((id) => `Exception removed: \`${id}\``),
  ...(report.exceptionRemoved.length > 20
    ? [
        `… ${report.exceptionRemoved.length - 20} additional exception removals.`,
      ]
    : []),
])}
${section("Blocking reasons", report.blockingReasons)}

## Contract checks

${contractLines.length > 0 ? contractLines.join("\n") : "_Not run._"}

Generated-file freshness remains enforced by the existing CI codegen-drift job;
the policy intentionally does not run a mutating generator during validation.
`;
}

function getArg(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? (args[index + 1] as string) : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function main(): void {
  const root = repoRoot();
  const baselineFile = path.join(root, BASELINE_PATH);
  const current = snapshotCurrent(root);

  if (hasFlag("write-baseline")) {
    writeJson(baselineFile, {
      version: 1,
      findings: current.findings,
      exceptions: current.exceptions,
    } satisfies ArchitectureBaseline);
    console.log(
      `Wrote reviewed architecture baseline: ${current.findings.length} legacy finding(s), ${current.exceptions.length} exception(s).`,
    );
    return;
  }

  const base = getArg("base", "origin/main");
  let resolvedBase: string;
  try {
    resolvedBase = resolveBase(root, base);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }
  const baseSnapshot = snapshotAtRef(root, resolvedBase);
  const baseline = loadBaseline(baselineFile);
  const baselineErrors = validateBaseline(baseline);
  if (baselineErrors.length > 0) {
    console.error(baselineErrors.join("\n"));
    process.exitCode = 1;
    return;
  }

  const changedFiles = git(root, [
    "diff",
    "--name-only",
    `${resolvedBase}...HEAD`,
  ])
    .split("\n")
    .concat(
      git(root, ["diff", "--name-only", "HEAD"]).split("\n"),
      git(root, ["ls-files", "--others", "--exclude-standard"]).split("\n"),
    )
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file, index, files) => files.indexOf(file) === index);
  const baseBaseline = baselineAtRef(root, resolvedBase);
  const report = classifyArchitectureFindings(
    baseSnapshot,
    current,
    baseline,
    changedFiles,
    {
      baselineExistsAtBase: baseBaseline.exists,
      baselineAtBase: baseBaseline.baseline,
    },
  );
  report.contractChecks = runContractChecks(root, resolvedBase);
  for (const failed of report.contractChecks.filter((check) => !check.passed)) {
    report.blockingReasons.push(`contract check failed: ${failed.name}`);
  }

  const markdown = renderReport(report, current);
  if (hasFlag("write-report")) {
    fs.mkdirSync(path.dirname(path.join(root, REPORT_PATH)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(root, REPORT_PATH), markdown);
  }
  console.log(markdown);

  if (report.blockingReasons.length > 0) {
    console.error(
      `Architecture policy failed: ${report.blockingReasons.join("; ")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Architecture policy passed: ${report.unchangedLegacyFindings.length} reviewed legacy finding(s) remain; ${report.removedFindings.length} finding(s) were removed.`,
  );
}

if (process.argv[1]?.endsWith("check-architecture-policy.ts")) {
  main();
}
