import { HOUNDDOG_RELEASE } from "./hounddog-tool.js";

export const SEVERITIES = ["critical", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];
export interface PrivacyFinding {
  hash: string;
  severity: Severity;
  sink: string;
  file: string;
  line: number;
  types: string[];
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid HoundDog report object.");
  }
  return value as Record<string, unknown>;
}

/** Deliberately fail closed on changed or missing result fields. */
export function parseHounddogReport(
  input: unknown,
  files: ReadonlySet<string>,
): PrivacyFinding[] {
  const report = object(input);
  if (
    report.hounddog_version !== HOUNDDOG_RELEASE.version ||
    typeof report.start_time !== "string" ||
    typeof report.end_time !== "string" ||
    !Number.isFinite(Date.parse(report.start_time)) ||
    !Number.isFinite(Date.parse(report.end_time)) ||
    !Array.isArray(report.dataflows) ||
    !Array.isArray(report.data_element_occurrences) ||
    !Array.isArray(report.data_sink_occurrences) ||
    files.size === 0
  ) {
    throw new Error(
      "Incomplete or incompatible HoundDog report; coverage unavailable.",
    );
  }
  return report.dataflows.map((value: unknown) => {
    const flow = object(value);
    const segment = object(flow.code_segment);
    if (
      typeof flow.hash !== "string" ||
      !flow.hash ||
      !SEVERITIES.includes(flow.severity as Severity) ||
      typeof flow.data_sink_slug !== "string" ||
      typeof segment.rel_file_path !== "string" ||
      !files.has(segment.rel_file_path) ||
      !Number.isInteger(segment.line_start) ||
      (segment.line_start as number) < 1 ||
      !Array.isArray(flow.data_elements) ||
      flow.data_elements.length === 0
    ) {
      throw new Error("Invalid HoundDog finding; coverage unavailable.");
    }
    const types = flow.data_elements.map((element: unknown) => {
      const entry = object(element);
      if (typeof entry.data_element_slug !== "string") {
        throw new Error("Invalid HoundDog data element.");
      }
      return entry.data_element_slug;
    });
    return {
      hash: flow.hash,
      severity: flow.severity as Severity,
      sink: flow.data_sink_slug,
      file: segment.rel_file_path,
      line: segment.line_start as number,
      types: [...new Set(types)],
    };
  });
}

export function requiresPrivacyReview(findings: PrivacyFinding[]): boolean {
  return findings.some(
    (finding) =>
      finding.severity === "critical" || finding.severity === "medium",
  );
}
