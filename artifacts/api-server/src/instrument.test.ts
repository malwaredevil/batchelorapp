import { describe, expect, it } from "vitest";
import { deepScrubBody, scrubSensitiveData } from "./instrument";
import type * as Sentry from "@sentry/node";

// Architecture hardening (#754): a completion review caught that the original
// scrub only redacted TOP-LEVEL request-body keys. AgentPhone webhook bodies
// nest the actual private SMS text / call transcript under an intermediate
// `data` key (e.g. `req.body.data.message`, `req.body.data.transcript`), so a
// shallow scrub left that content untouched even though `message` and
// `transcript` are both in CONTENT_BODY_KEYS. These tests pin the fix: no
// literal sensitive/content value may survive `beforeSend` at any nesting
// depth, including inside arrays.
describe("deepScrubBody", () => {
  it("redacts content/sensitive keys nested under an intermediate object key (AgentPhone webhook shape)", () => {
    const body = {
      data: {
        message: "call me back, the surgery went fine",
        transcript: "hi this is a private voicemail transcript",
        token: "super-secret-webhook-token",
        callId: "abc-123",
      },
    };
    const scrubbed = deepScrubBody(body) as {
      data: Record<string, unknown>;
    };
    expect(JSON.stringify(scrubbed)).not.toContain("call me back");
    expect(JSON.stringify(scrubbed)).not.toContain("private voicemail");
    expect(JSON.stringify(scrubbed)).not.toContain(
      "super-secret-webhook-token",
    );
    expect(scrubbed.data.token).toBe("[Filtered]");
    expect(scrubbed.data.message).toMatch(/^\[Redacted:\d+chars\]$/);
    expect(scrubbed.data.transcript).toMatch(/^\[Redacted:\d+chars\]$/);
    // Non-sensitive fields at the same depth are left untouched.
    expect(scrubbed.data.callId).toBe("abc-123");
  });

  it("redacts sensitive/content keys inside arrays of nested objects", () => {
    const body = {
      messages: [
        { role: "user", content: "actual private chat text" },
        { role: "assistant", content: "another private reply" },
      ],
    };
    const scrubbed = deepScrubBody(body) as {
      messages: Array<Record<string, unknown>>;
    };
    // `messages` itself is a CONTENT_BODY_KEYS hit, so the whole array is
    // collapsed to a length marker rather than walked further — either way,
    // no literal private text may survive.
    expect(JSON.stringify(scrubbed)).not.toContain("actual private chat text");
    expect(JSON.stringify(scrubbed)).not.toContain("another private reply");
  });

  it("redacts deeply nested secrets several levels down", () => {
    const body = {
      outer: {
        middle: {
          inner: {
            secret: "sk-live-should-never-leak",
          },
        },
      },
    };
    const scrubbed = deepScrubBody(body) as {
      outer: { middle: { inner: { secret: unknown } } };
    };
    expect(scrubbed.outer.middle.inner.secret).toBe("[Filtered]");
  });

  it("leaves ordinary non-sensitive data untouched", () => {
    const body = { status: "ok", count: 3, nested: { id: 42 } };
    expect(deepScrubBody(body)).toEqual(body);
  });
});

describe("scrubSensitiveData", () => {
  it("scrubs nested webhook-shaped event.request.data in place", () => {
    const event = {
      request: {
        data: {
          data: {
            message: "this is the literal private sms text",
            transcript: "this is the literal private voice transcript",
          },
        },
      },
    } as unknown as Sentry.ErrorEvent;

    const result = scrubSensitiveData(event);
    const serialized = JSON.stringify(result.request?.data);
    expect(serialized).not.toContain("literal private sms text");
    expect(serialized).not.toContain("literal private voice transcript");
  });
});
