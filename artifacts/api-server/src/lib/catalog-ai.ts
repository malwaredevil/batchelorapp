import pLimit from "p-limit";
import { getConfig } from "./app-config";

// Keep the owner's chosen model, but route cataloguing work to a low-latency
// provider and request a small reasoning effort instead of an unbounded pass.
// This is deliberately NOT used by Elaine's conversational/voice reasoning.
export const CATALOG_AI_REQUEST_OPTIONS = {
  reasoning: { effort: "low", exclude: true },
  provider: { sort: "latency" },
} as const;

export class CatalogAIBusyError extends Error {
  readonly status = 503;

  constructor() {
    super(
      "Ornament AI processing is busy. Please try this item again shortly.",
    );
    this.name = "CatalogAIBusyError";
  }
}

// One gate per server process, not one per HTTP request or selected item.
const catalogLimit = pLimit(1);

export async function runCatalogAI<T>(run: () => Promise<T>): Promise<T> {
  const [concurrency, maxQueued, waitMs] = await Promise.all([
    getConfig("openrouter", "catalog_concurrency", 4),
    getConfig("openrouter", "catalog_max_queued", 32),
    getConfig("openrouter", "catalog_queue_wait_ms", 12_000),
  ]);
  for (const value of [concurrency, maxQueued, waitMs]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error("Invalid catalog AI capacity configuration.");
    }
  }
  catalogLimit.concurrency = concurrency;
  if (catalogLimit.pendingCount >= maxQueued) throw new CatalogAIBusyError();

  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new CatalogAIBusyError());
    }, waitMs);
  });
  const execution = catalogLimit(async () => {
    // A timed-out queue entry must never start a late, paid model request.
    if (expired) throw new CatalogAIBusyError();
    clearTimeout(timer);
    return run();
  });
  try {
    return await Promise.race([execution, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}
