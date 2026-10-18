import { describe, expect, it } from "vitest";
import { communicationLogOutcome } from "./communication-log-outcome";

describe("bounded communication diagnostics", () => {
  it.each([
    ["sent", "sent"],
    ["already sent", "already_complete"],
    ["n/a", "already_complete"],
    ["unknown: pending provider outcome", "unknown"],
    ["error: recipient user@example.invalid", "error"],
    ["unknown: recipient +12025550199", "unknown"],
    ["unexpected user@example.invalid +12025550199", "skipped"],
    ["disabled", "skipped"],
  ])("maps %s to a constant safe category", (input, outcome) => {
    expect(communicationLogOutcome(input)).toBe(outcome);
  });
});
