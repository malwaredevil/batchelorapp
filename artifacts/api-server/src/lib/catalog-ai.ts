import pLimit from "p-limit";
import { getConfig } from "./app-config";
import { getCatalogAISignal } from "./catalog-ai-context";

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
  const signal = getCatalogAISignal();
  signal?.throwIfAborted();
  const [concurrency, maxQueued, waitMs] = await Promise.all([
    getConfig("openrouter", "catalog_concurrency", 4),
    getConfig("openrouter", "catalog_max_queued", 32),
    getConfig("openrouter", "catalog_queue_wait_ms", 12_000),
  ]);
  signal?.throwIfAborted();
  for (const value of [concurrency, maxQueued, waitMs]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error("Invalid catalog AI capacity configuration.");
    }
  }
  if (waitMs > 2_147_483_647) {
    throw new Error("Invalid catalog AI queue timeout.");
  }
  catalogLimit.concurrency = concurrency;
  if (catalogLimit.pendingCount >= maxQueued) throw new CatalogAIBusyError();

  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      expired = true;
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      expired = true;
      reject(new CatalogAIBusyError());
    }, waitMs);
  });
  const execution = catalogLimit(async () => {
    // A timed-out queue entry must never start a late, paid model request.
    if (expired) throw new CatalogAIBusyError();
    signal?.throwIfAborted();
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort!);
    // Retain the slot until an already-started provider call actually settles.
    // Racing its cancellation would hide still-running paid work from the cap.
    return run();
  });
  try {
    return await Promise.race([execution, deadline]);
  } finally {
    clearTimeout(timer!);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
