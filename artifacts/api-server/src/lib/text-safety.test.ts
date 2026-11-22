import { describe, expect, it } from "vitest";
import { stripTextMarkup } from "@workspace/web-core/text-safety";
import { sanitizeRuntimeText } from "../elaine/runtime/contracts";
import { detectStatedLocation } from "../elaine/location-helpers";

describe("linear text cleanup", () => {
  const reasoning = {
    hiddenTags: ["think", "thinking", "reasoning"],
    replacement: "[private reasoning omitted]",
  };

  it("omits nested, mixed-case and unterminated private reasoning", () => {
    expect(
      stripTextMarkup(
        "before<THINK>a<thinking>b</thinking>c</THINK>after",
        reasoning,
      ),
    ).toBe("before[private reasoning omitted]after");
    expect(stripTextMarkup("before<think>unfinished secret", reasoning)).toBe(
      "before[private reasoning omitted]",
    );
    expect(
      sanitizeRuntimeText("safe <reasoning>do not expose</reasoning> end"),
    ).toBe("safe [private reasoning omitted] end");
  });

  it("preserves Unicode offsets and unrelated markup", () => {
    expect(
      stripTextMarkup("İ <think>secret</think> 日本 <b>visible</b>", reasoning),
    ).toBe("İ [private reasoning omitted] 日本 <b>visible</b>");
  });

  it("cleans scripts and ordinary markup as text, including spaced end tags", () => {
    expect(
      stripTextMarkup('<b>Cat</b><SCRIPT type="x">bad</script > <i>Blue</i>', {
        hiddenTags: ["script"],
        replacement: "",
        stripOtherTags: true,
      }),
    ).toBe(" Cat   Blue ");
  });

  it("handles repeated unmatched openings and malformed brackets without rescans", () => {
    expect(
      stripTextMarkup("<think>".repeat(40_000) + "private", reasoning),
    ).toBe("[private reasoning omitted]");
    expect(stripTextMarkup("<".repeat(200_000) + "text", reasoning)).toBe(
      "<".repeat(200_000) + "text",
    );
  });

  it("handles adversarial location whitespace and preserves later valid statements", () => {
    expect(
      detectStatedLocation(
        "staying in" + " ".repeat(80_000) + "nowhere\nunfinished",
      ),
    ).toBeNull();
    expect(detectStatedLocation("visiting nowhere\nvisiting Stuttgart.")).toBe(
      "Stuttgart",
    );
    expect(detectStatedLocation("I'm in Kyoto, near the station.")).toBe(
      "Kyoto",
    );
  });
});
