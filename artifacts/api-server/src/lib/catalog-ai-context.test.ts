import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import {
  catalogAIRequestContext,
  getCatalogAISignal,
} from "./catalog-ai-context";

function scope() {
  const req = Object.assign(new EventEmitter(), { aborted: false });
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableFinished: false,
  });
  let signal!: AbortSignal;
  let pending!: Promise<AbortSignal | undefined>;
  catalogAIRequestContext(req as Request, res as Response, () => {
    signal = getCatalogAISignal()!;
    pending = Promise.resolve().then(() => getCatalogAISignal());
  });
  return { req, res, signal, pending };
}

describe("catalog HTTP lifetime", () => {
  it("propagates the signal across asynchronous stages and cancels disconnects", async () => {
    const { req, res, signal, pending } = scope();
    expect(await pending).toBe(signal);
    res.emit("close");
    expect(signal.aborted).toBe(true);
    expect(signal.reason.status).toBe(408);
    expect(req.listenerCount("aborted")).toBe(0);
    expect(res.listenerCount("finish")).toBe(0);
  });

  it("does not cancel normal responses or intentional detached work", () => {
    const { res, signal } = scope();
    res.writableFinished = true;
    res.emit("finish");
    res.emit("close");
    expect(signal.aborted).toBe(false);
    expect(res.listenerCount("close")).toBe(0);
    expect(getCatalogAISignal()).toBeUndefined();
  });

  it("isolates requests and recognizes aborted request bodies", () => {
    const first = scope();
    const second = scope();
    first.req.emit("aborted");
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    second.res.writableFinished = true;
    second.res.emit("finish");
  });
});
