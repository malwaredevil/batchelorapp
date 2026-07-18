import { describe, expect, it } from "vitest";
import { redactMetadata } from "./operations";

describe("external operation redaction", () => {
  it("redacts sensitive metadata keys before persistence or export", () => {
    expect(
      redactMetadata({
        model: "google/gemini-2.5-flash",
        prompt: "private household prompt",
        accessToken: "secret-token",
        durationBucket: "fast",
      }),
    ).toEqual({
      model: "google/gemini-2.5-flash",
      prompt: "[redacted]",
      accessToken: "[redacted]",
      durationBucket: "fast",
    });
  });
});
