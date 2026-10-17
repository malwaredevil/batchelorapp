import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";

const requests = new AsyncLocalStorage<AbortSignal>();

export const getCatalogAISignal = () => requests.getStore();

export function withCatalogAISignal<T>(signal: AbortSignal, run: () => T): T {
  return requests.run(signal, run);
}

export class CatalogAIRequestEndedError extends Error {
  readonly status = 408;

  constructor() {
    super(
      "Processing stopped because the request ended. Check the item's saved state before retrying.",
    );
    this.name = "CatalogAIRequestEndedError";
  }
}

// A proxy/client disconnect cancels later paid stages. Normal response completion
// does not cancel deliberately detached work, and callers outside HTTP have no
// request signal. Do not impose a short whole-batch timeout on bulk refreshes.
export const catalogAIRequestContext: RequestHandler = (req, res, next) => {
  const controller = new AbortController();
  const cleanup = () => {
    req.removeListener("aborted", abort);
    res.removeListener("close", close);
    res.removeListener("finish", cleanup);
  };
  const abort = () => {
    controller.abort(new CatalogAIRequestEndedError());
    cleanup();
  };
  const close = () => {
    if (!res.writableFinished) abort();
    else cleanup();
  };
  req.once("aborted", abort);
  res.once("close", close);
  res.once("finish", cleanup);
  if (req.aborted || res.destroyed) abort();
  withCatalogAISignal(controller.signal, next);
};
