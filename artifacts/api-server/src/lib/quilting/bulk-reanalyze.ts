import { getElaineGlobalConfig } from "../elaine-config";

export type BulkReanalyzeResult = { succeeded: number[]; failed: number[] };

/**
 * Runs a configured, bounded batch in request order. A pause is deliberately
 * applied only after successful work when another item remains.
 */
export async function runQuiltingBulkReanalysis(
  ids: number[],
  recognize: (id: number) => Promise<unknown>,
): Promise<BulkReanalyzeResult> {
  const config = await getElaineGlobalConfig();
  const capped = [...new Set(ids)].slice(
    0,
    config.thresholds.quiltingBulkReanalyzeLimit,
  );
  const succeeded: number[] = [];
  const failed: number[] = [];

  for (const [index, id] of capped.entries()) {
    try {
      await recognize(id);
      succeeded.push(id);
      if (index < capped.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } catch {
      failed.push(id);
    }
  }

  return { succeeded, failed };
}
