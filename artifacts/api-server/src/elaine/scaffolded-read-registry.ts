/**
 * scaffolded-read-registry.ts — dispatch registry for read/hard tools created by
 * `pnpm --filter @workspace/scripts run scaffold:elaine-action`.
 *
 * The generator inserts one entry per scaffolded read tool into
 * SCAFFOLDED_READ_TOOL_EXECUTORS (idempotent anchored insertion). index.ts's
 * model-visible hard-tool dispatcher consults this registry via
 * isScaffoldedReadTool/executeScaffoldedReadTool, so a freshly scaffolded read
 * tool resolves end-to-end (returning its 501 stub message) instead of
 * "Unsupported tool." Once the stub's business logic is implemented, the tool
 * can stay here or be promoted into a hand-written dispatch branch.
 */

type ScaffoldedReadExecutor = (args: string, userId: number) => Promise<string>;

export const SCAFFOLDED_READ_TOOL_EXECUTORS: Record<
  string,
  ScaffoldedReadExecutor
> = {
  // scaffold:elaine-action inserts entries here — do not remove this object.
};

export function isScaffoldedReadTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    SCAFFOLDED_READ_TOOL_EXECUTORS,
    name,
  );
}

export async function executeScaffoldedReadTool(
  name: string,
  args: string,
  userId: number,
): Promise<string> {
  const executor = SCAFFOLDED_READ_TOOL_EXECUTORS[name];
  if (!executor) return "Unsupported tool.";
  return executor(args, userId);
}
