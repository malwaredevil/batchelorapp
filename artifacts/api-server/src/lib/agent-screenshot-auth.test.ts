import { describe, expect, it } from "vitest";
import { deriveAgentScreenshotToken } from "./agent-screenshot-auth";

describe("deriveAgentScreenshotToken", () => {
  it("is deterministic for the same pepper", () => {
    const a = deriveAgentScreenshotToken("pepper-value");
    const b = deriveAgentScreenshotToken("pepper-value");
    expect(a).toBe(b);
  });

  it("changes when the pepper changes (rotation invalidates old derived tokens)", () => {
    const before = deriveAgentScreenshotToken("pepper-value");
    const after = deriveAgentScreenshotToken("a-different-pepper-value");
    expect(before).not.toBe(after);
  });

  it("never returns the raw pepper itself", () => {
    const pepper = "some-secret-pepper";
    const derived = deriveAgentScreenshotToken(pepper);
    expect(derived).not.toBe(pepper);
    expect(derived).not.toContain(pepper);
  });

  it("produces a fixed-length hex digest", () => {
    const derived = deriveAgentScreenshotToken("anything");
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
  });
});
