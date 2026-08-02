import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

type UnknownRecord = Record<string, unknown>;

const FULL_SHA = /^[0-9a-f]{40}$/i;
const PRIVILEGED_CODE_EXECUTION =
  /\b(?:git\s+(?:checkout|fetch)|gh\s+pr\s+checkout|npm|npx|pnpm|yarn|bun|make)\b/i;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function eventEnabled(workflow: UnknownRecord, event: string): boolean {
  const triggers = workflow["on"];
  if (typeof triggers === "string") return triggers === event;
  if (Array.isArray(triggers)) return triggers.includes(event);
  const triggerMap = asRecord(triggers);
  return triggerMap
    ? Object.prototype.hasOwnProperty.call(triggerMap, event)
    : false;
}

export function inspectWorkflow(
  source: string,
  filename = "workflow.yml",
): string[] {
  const errors: string[] = [];
  let workflow: UnknownRecord;

  try {
    const parsed = YAML.parse(source) as unknown;
    const record = asRecord(parsed);
    if (!record) return [`${filename}: workflow root must be a mapping`];
    workflow = record;
  } catch (error) {
    return [
      `${filename}: invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  const permissions = asRecord(workflow.permissions);
  if (!permissions) {
    errors.push(`${filename}: declare explicit top-level permissions`);
  } else {
    for (const [scope, access] of Object.entries(permissions)) {
      if (!["read", "write", "none"].includes(String(access))) {
        errors.push(
          `${filename}: invalid permission ${scope}: ${String(access)}`,
        );
      }
    }
  }

  const jobs = asRecord(workflow.jobs);
  if (!jobs || Object.keys(jobs).length === 0) {
    errors.push(`${filename}: define at least one job`);
    return errors;
  }

  const privileged = eventEnabled(workflow, "pull_request_target");

  for (const [jobName, jobValue] of Object.entries(jobs)) {
    const job = asRecord(jobValue);
    if (!job) {
      errors.push(`${filename}:${jobName}: job must be a mapping`);
      continue;
    }

    const timeout = job["timeout-minutes"];
    if (
      typeof timeout !== "number" ||
      !Number.isInteger(timeout) ||
      timeout < 1 ||
      timeout > 60
    ) {
      errors.push(
        `${filename}:${jobName}: set timeout-minutes to an integer from 1 to 60`,
      );
    }

    if (job.secrets === "inherit") {
      errors.push(`${filename}:${jobName}: secrets: inherit is prohibited`);
    }

    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const [index, stepValue] of steps.entries()) {
      const step = asRecord(stepValue);
      if (!step) continue;
      const location = `${filename}:${jobName}:step ${index + 1}`;
      const uses = typeof step.uses === "string" ? step.uses : "";

      if (uses && !uses.startsWith("./") && !uses.startsWith("docker://")) {
        const at = uses.lastIndexOf("@");
        const ref = at >= 0 ? uses.slice(at + 1) : "";
        if (!FULL_SHA.test(ref)) {
          errors.push(`${location}: pin ${uses} to a full 40-character SHA`);
        }
      }

      if (uses.startsWith("actions/checkout@")) {
        const withInputs = asRecord(step.with);
        if (withInputs?.["persist-credentials"] !== false) {
          errors.push(
            `${location}: actions/checkout must set persist-credentials: false`,
          );
        }
        if (privileged) {
          errors.push(
            `${location}: pull_request_target workflows may not check out repository code`,
          );
        }
      }

      if (
        privileged &&
        typeof step.run === "string" &&
        PRIVILEGED_CODE_EXECUTION.test(step.run)
      ) {
        errors.push(
          `${location}: pull_request_target workflow may not fetch or execute repository code`,
        );
      }
    }
  }

  return errors;
}

export function inspectWorkflowDirectory(directory: string): string[] {
  return fs
    .readdirSync(directory)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort()
    .flatMap((name) =>
      inspectWorkflow(
        fs.readFileSync(path.join(directory, name), "utf8"),
        name,
      ),
    );
}

/**
 * Composite actions (.github/actions/<name>/action.yml) don't have `jobs` or
 * top-level `permissions` — they're a flat list of steps under `runs:`. This
 * checks the same two step-level rules that matter for security: pinned SHAs
 * on external actions, and persist-credentials: false on checkout.
 */
export function inspectActionFile(source: string, label: string): string[] {
  const errors: string[] = [];
  let action: UnknownRecord;

  try {
    const parsed = YAML.parse(source) as unknown;
    const record = asRecord(parsed);
    if (!record) return [`${label}: action root must be a mapping`];
    action = record;
  } catch (error) {
    return [
      `${label}: invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  const runs = asRecord(action.runs);
  const steps = Array.isArray(runs?.steps) ? runs.steps : [];

  for (const [index, stepValue] of steps.entries()) {
    const step = asRecord(stepValue);
    if (!step) continue;
    const location = `${label}: step ${index + 1}`;
    const uses = typeof step.uses === "string" ? step.uses : "";

    if (uses && !uses.startsWith("./") && !uses.startsWith("docker://")) {
      const at = uses.lastIndexOf("@");
      const ref = at >= 0 ? uses.slice(at + 1) : "";
      if (!FULL_SHA.test(ref)) {
        errors.push(`${location}: pin ${uses} to a full 40-character SHA`);
      }
    }

    if (uses.startsWith("actions/checkout@")) {
      const withInputs = asRecord(step.with);
      if (withInputs?.["persist-credentials"] !== false) {
        errors.push(
          `${location}: actions/checkout must set persist-credentials: false`,
        );
      }
    }
  }

  return errors;
}

export function inspectActionsDirectory(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const actionPath = ["action.yml", "action.yaml"]
        .map((name) => path.join(directory, entry.name, name))
        .find((candidate) => fs.existsSync(candidate));
      if (!actionPath) return [];
      return inspectActionFile(
        fs.readFileSync(actionPath, "utf8"),
        `.github/actions/${entry.name}/${path.basename(actionPath)}`,
      );
    });
}

function main(): void {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const errors = [
    ...inspectWorkflowDirectory(path.join(root, ".github/workflows")),
    ...inspectActionsDirectory(path.join(root, ".github/actions")),
  ];
  if (errors.length > 0) {
    console.error("Workflow security policy violations:\n");
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("✓ GitHub workflows satisfy the repository security policy");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
