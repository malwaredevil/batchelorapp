import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { Sentry } from "./sentry";
import {
  classifyOptionalLookupTimeout,
  withOptionalAILookup,
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
});
