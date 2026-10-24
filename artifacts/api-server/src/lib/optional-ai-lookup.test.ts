import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { Sentry } from "./sentry";
import {
  classifyOptionalLookupTimeout,
  withOptionalAILookup,
  withRecoverableAIRequest,
} from "./optional-ai-lookup";

describe("optional AI lookup telemetry", () => {
  const event: Sentry.Event = {
    level: "error",
    exception: {
      values: [
        {
          type: "Error",
          value: "Request timed out.",
          mechanism: { type: "auto.ai.openai", handled: false },
        },
      ],
    },
  };

  it("retains optional SDK timeout events as handled warnings", () => {
    const result = classifyOptionalLookupTimeout(event, {
      originalException: new OpenAI.APIConnectionTimeoutError(),
    });
    expect(result.level).toBe("warning");
    expect(result.exception?.values?.[0]?.mechanism?.handled).toBe(true);
    expect(result.exception?.values?.[0]?.value).toBe("Request timed out.");
    expect(event.level).toBe("error");
    expect(event.exception?.values?.[0]?.mechanism?.handled).toBe(false);
  });

  it("does not downgrade authentication, programming, or generic errors", () => {
    for (const error of [
      new Error("Request timed out."),
      new TypeError("bad result"),
      new OpenAI.AuthenticationError(401, {}, "unauthorized", new Headers()),
    ]) {
      expect(
        classifyOptionalLookupTimeout(event, { originalException: error }),
      ).toBe(event);
    }
  });

  it("does not downgrade route-level captures or other mechanisms", () => {
    const routeEvent: Sentry.Event = {
      ...event,
      exception: {
        values: [{ mechanism: { type: "generic", handled: false } }],
      },
    };
    expect(
      classifyOptionalLookupTimeout(routeEvent, {
        originalException: new OpenAI.APIConnectionTimeoutError(),
      }),
    ).toBe(routeEvent);
  });

  it("isolates classification from concurrent required AI work", async () => {
    const parentScope = Sentry.getCurrentScope();
    const parentProcessors = [...parentScope.getScopeData().eventProcessors];
    await withOptionalAILookup(async () => {
      expect(Sentry.getCurrentScope()).not.toBe(parentScope);
      expect(Sentry.getCurrentScope().getScopeData().eventProcessors).toContain(
        classifyOptionalLookupTimeout,
      );
    });
    expect(Sentry.getCurrentScope()).toBe(parentScope);
    expect(parentScope.getScopeData().eventProcessors).toEqual(
      parentProcessors,
    );
  });

  it("propagates failures for the caller to handle, without retrying", async () => {
    const error = new OpenAI.APIConnectionTimeoutError();
    await expect(
      withOptionalAILookup(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it("waits for confirmed recovery before downgrading an SDK timeout", async () => {
    let timeoutEvent!: Promise<Sentry.Event | null>;
    let recover!: () => void;
    const recovered = new Promise<void>((resolve) => {
      recover = resolve;
    });
    const workflow = withRecoverableAIRequest(async () => {
      const processors =
        Sentry.getCurrentScope().getScopeData().eventProcessors;
      const processor = processors[processors.length - 1]!;
      timeoutEvent = Promise.resolve(
        processor(event, {
          originalException: new OpenAI.APIConnectionTimeoutError(),
        }),
      );
      await recovered;
      return "fallback result";
    });
    const observed = vi.fn();
    void timeoutEvent.then(observed);
    await Promise.resolve();
    expect(observed).not.toHaveBeenCalled();
    recover();
    await expect(workflow).resolves.toBe("fallback result");
    await expect(timeoutEvent).resolves.toMatchObject({
      level: "warning",
      exception: { values: [{ mechanism: { handled: true } }] },
    });
  });

  it("keeps the original SDK error when recovery fails and does not retry", async () => {
    let timeoutEvent!: Promise<Sentry.Event | null>;
    const error = new OpenAI.APIConnectionTimeoutError();
    const operation = vi.fn(async () => {
      const processors =
        Sentry.getCurrentScope().getScopeData().eventProcessors;
      timeoutEvent = Promise.resolve(
        processors[processors.length - 1]!(event, {
          originalException: error,
        }),
      );
      throw error;
    });
    await expect(withRecoverableAIRequest(operation)).rejects.toBe(error);
    await expect(timeoutEvent).resolves.toBe(event);
    expect(operation).toHaveBeenCalledOnce();
  });

  it("does not change unrelated errors after successful recovery or leak scope", async () => {
    const parent = Sentry.getCurrentScope();
    const previous = [...parent.getScopeData().eventProcessors];
    let unrelated!: Promise<Sentry.Event | null>;
    await withRecoverableAIRequest(async () => {
      const processors =
        Sentry.getCurrentScope().getScopeData().eventProcessors;
      unrelated = Promise.resolve(
        processors[processors.length - 1]!(event, {
          originalException: new TypeError("bad response"),
        }),
      );
    });
    await expect(unrelated).resolves.toBe(event);
    expect(Sentry.getCurrentScope()).toBe(parent);
    expect(parent.getScopeData().eventProcessors).toEqual(previous);
  });
});
