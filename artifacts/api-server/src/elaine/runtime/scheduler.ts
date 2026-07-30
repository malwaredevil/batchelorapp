export const ELAINE_READ_CONCURRENCY = 3;

/**
 * Runs independent read work with a fixed concurrency limit while preserving
 * input order in the returned observations. Rejects immediately on invalid
 * limits so a configuration error cannot silently create unbounded work.
 */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Concurrency limit must be a positive integer");
  }

  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await worker(values[index]!, index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () =>
      runWorker(),
    ),
  );
  return results;
}
