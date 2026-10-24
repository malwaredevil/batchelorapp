import { describe, expect, it } from "vitest";
import {
  CallConstraintsSchema,
  callPreflight,
  bindCallRequestConstraints,
  callPreflightUserMessage,
} from "./call-preflight";

describe("call preflight", () => {
  it.each([
    "if she doesn't answer, leave a message saying hello",
    "if unanswered, leave her a message",
    "leave the same text if no one picks up",
    "leave a recording on the answering machine",
    "deliver this as voice-mail",
    "Leave a message. If she picks up, say hello.",
  ])("keeps the user's voicemail requirement: %s", (requirement) => {
    for (const name of ["call_me", "call_contact"]) {
      for (const scheduleAt of [undefined, "2026-10-25T10:00:00Z"]) {
        const payload = bindCallRequestConstraints(
          name,
          { greeting: "Hello", message: "Hello", scheduleAt },
          `Call Jane and ${requirement}`,
        );
        expect(callPreflight(payload)?.body.code).toBe(
          "voicemail_script_unsupported",
        );
      }
    }
  });

  it.each(['"Bring tea"', "“Bring tea”", "'Bring tea'", "‘Bring tea’"])(
    "copies exact quoted wording instead of the model's rewrite: %s",
    (quoted) => {
      for (const name of ["call_me", "call_contact"]) {
        for (const scheduleAt of [undefined, "2026-10-25T10:00:00Z"]) {
          const payload = bindCallRequestConstraints(
            name,
            {
              greeting: "Hi, bring tea.",
              message: "Hi, bring tea.",
              scheduleAt,
            },
            `Call me and say exactly ${quoted}`,
          );
          expect(payload).toHaveProperty(
            name === "call_me" ? "greeting" : "message",
            "Bring tea",
          );
          expect(callPreflight(payload)).toBeNull();
        }
      }
    },
  );

  it("treats exact spoken text as data, not a destination or voicemail instruction", () => {
    const script = "Don't leave a message at +12105551234.\nBring tea.";
    const payload = bindCallRequestConstraints(
      "call_me",
      { greeting: "rewritten" },
      `Call me and say exactly “${script}”`,
    );
    expect(payload).toHaveProperty("greeting", script);
    expect(payload).not.toHaveProperty("expectedDestination");
    expect(payload).not.toHaveProperty("voicemailMessage");
    expect(callPreflight(payload)).toBeNull();
  });

  it.each([
    "say exactly: Bring tea.",
    'say exactly ""',
    'say exactly "Bring tea',
    'say exactly "Bring tea" or "Bring coffee"',
    "say exactly 'Don't forget tea'",
  ])(
    "requires clarification instead of guessing the exact script: %s",
    (instruction) => {
      const payload = bindCallRequestConstraints(
        "call_me",
        { greeting: "a guess" },
        `Call me and ${instruction}`,
      );
      expect(callPreflight(payload)?.body).toMatchObject({
        attempted: false,
        code: "call_script_clarification_required",
      });
    },
  );

  it("does not mistake an exact scheduled time for an exact-script requirement", () => {
    expect(
      callPreflight(
        bindCallRequestConstraints(
          "call_me",
          { greeting: "Hello" },
          "Call me exactly at 4 PM",
        ),
      ),
    ).toBeNull();
  });

  it("pins the explicit number from the user even when the model omits or substitutes it", () => {
    expect(
      bindCallRequestConstraints(
        "call_me",
        { greeting: "Bring tea.", expectedDestination: "+12105559999" },
        "Call me at +1 (210) 555-0123 now.",
      ),
    ).toMatchObject({ expectedDestination: "+12105550123" });
    expect(
      bindCallRequestConstraints(
        "call_me",
        { greeting: "Bring tea." },
        "Call me and leave the same text as voicemail if unanswered.",
      ),
    ).toMatchObject({
      voicemailMessage: "Requested voicemail delivery",
    });
    expect(
      bindCallRequestConstraints(
        "call_me",
        { greeting: "Bring tea." },
        "Call me; do not leave voicemail.",
      ),
    ).not.toHaveProperty("voicemailMessage");
  });
  it("does not infer a destination from other tools or choose among ambiguous numbers", () => {
    expect(
      bindCallRequestConstraints("web_search", {}, "Call +12105550123"),
    ).toEqual({});
    const constraints = bindCallRequestConstraints(
      "call_me",
      {},
      "Call +12105550123 or +12105550456",
    );
    expect(callPreflight(constraints)?.body.code).toBe(
      "invalid_call_requirements",
    );
  });
  it("reports only fixed server-owned errors, never arbitrary provider details", () => {
    expect(
      callPreflightUserMessage({
        attempted: false,
        code: "voicemail_script_unsupported",
        error: "INTERNAL_SECRET",
      }),
    ).not.toContain("INTERNAL_SECRET");
    expect(
      callPreflightUserMessage({
        attempted: false,
        code: "__proto__",
        error: "LEAK",
      }),
    ).toBeNull();
    expect(callPreflightUserMessage({ error: "LEAK" })).toBeNull();
  });
  it("normalizes a supplied constraint without turning it into a dial destination", () => {
    expect(
      callPreflight(
        { expectedDestination: "+1 (210) 555-0123" },
        "+12105550123",
      ),
    ).toBeNull();
    expect(
      CallConstraintsSchema.parse({ expectedDestination: "+1 (210) 555-0123" }),
    ).toEqual({
      expectedDestination: "+12105550123",
    });
  });
  it("rejects a destination mismatch without exposing the stored number", () => {
    const result = callPreflight(
      { expectedDestination: "+12105550123" },
      "+12105550456",
    );
    expect(result?.body).toMatchObject({
      attempted: false,
      code: "call_destination_mismatch",
    });
    expect(JSON.stringify(result)).not.toContain("+12105550456");
  });
  it.each(["2105550123", "+1210; rm -rf /", "javascript:12345678", ""])(
    "rejects invalid destination %s",
    (expectedDestination) => {
      expect(callPreflight({ expectedDestination })?.body.code).toBe(
        "invalid_call_requirements",
      );
    },
  );
  it("fails closed on a per-call voicemail requirement, even when equal to the spoken script", () => {
    expect(
      callPreflight({ voicemailMessage: "Exact script" })?.body,
    ).toMatchObject({
      attempted: false,
      code: "voicemail_script_unsupported",
    });
  });
  it("supports normal answer-first calls without voicemail requirements", () => {
    expect(callPreflight({})).toBeNull();
  });
});
