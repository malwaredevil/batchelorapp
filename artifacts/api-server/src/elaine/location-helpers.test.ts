import { describe, it, expect } from "vitest";
import {
  detectLocationClear,
  detectStatedLocation,
} from "./location-helpers.js";

describe("detectLocationClear", () => {
  // Core phrases documented in the task
  it('matches "I left [place]" (simple past, no apostrophe)', () => {
    expect(detectLocationClear("I left Gion")).toBe(true);
  });

  it('matches "I\'ve left [place]"', () => {
    expect(detectLocationClear("I've left Gion")).toBe(true);
  });

  it('matches "I\u2019ve left [place]" (curly apostrophe)', () => {
    expect(detectLocationClear("I\u2019ve left Gion")).toBe(true);
  });

  it('matches "I\'m back home"', () => {
    expect(detectLocationClear("I'm back home")).toBe(true);
  });

  it('matches "we\'re back home"', () => {
    expect(detectLocationClear("we're back home")).toBe(true);
  });

  it('matches "never mind the location"', () => {
    expect(detectLocationClear("never mind the location")).toBe(true);
  });

  it('matches "never mind my location"', () => {
    expect(detectLocationClear("never mind my location")).toBe(true);
  });

  it('matches "forget my location"', () => {
    expect(detectLocationClear("Forget my location")).toBe(true);
  });

  it('matches "clear my location"', () => {
    expect(detectLocationClear("clear my location")).toBe(true);
  });

  it('matches "ignore my location"', () => {
    expect(detectLocationClear("ignore my location")).toBe(true);
  });

  it('matches "I\'m not in Gion anymore"', () => {
    expect(detectLocationClear("I'm not in Gion anymore")).toBe(true);
  });

  it('matches "I\'m no longer in Gion"', () => {
    expect(detectLocationClear("I'm no longer in Gion")).toBe(true);
  });

  it('matches "I\'m not there anymore"', () => {
    expect(detectLocationClear("I'm not there anymore")).toBe(true);
  });

  it('matches "heading home"', () => {
    expect(detectLocationClear("heading home now")).toBe(true);
  });

  it('matches "going home"', () => {
    expect(detectLocationClear("going home")).toBe(true);
  });

  it('matches "on my way home"', () => {
    expect(detectLocationClear("I'm on my way home")).toBe(true);
  });

  // Non-matching cases
  it("does not match an unrelated message", () => {
    expect(detectLocationClear("What's the weather like here?")).toBe(false);
  });

  it("does not match a positive location statement", () => {
    expect(detectLocationClear("I'm in Kyoto")).toBe(false);
  });

  it("does not match 'I love Kyoto' (no clear signal)", () => {
    expect(detectLocationClear("I love Kyoto")).toBe(false);
  });

  // Clear wins over a simultaneous positive-location phrase
  it("returns true when message contains both a clear phrase and a location name", () => {
    // "I left Gion" contains "left" (clear) — even though "Gion" is a place
    expect(detectLocationClear("I left Gion and I'm now at Fushimi")).toBe(
      true,
    );
  });
});

describe("detectStatedLocation", () => {
  it('extracts location from "I\'m in Gion"', () => {
    expect(detectStatedLocation("I'm in Gion")).toBe("Gion");
  });

  it('extracts location from "I am at the hotel"', () => {
    expect(detectStatedLocation("I am at the hotel")).toBe("the hotel");
  });

  it('extracts location from "just arrived in Kyoto"', () => {
    expect(detectStatedLocation("just arrived in Kyoto")).toBe("Kyoto");
  });

  it('extracts location from "currently in Osaka"', () => {
    expect(detectStatedLocation("currently in Osaka")).toBe("Osaka");
  });

  it("returns null for an unrelated message", () => {
    expect(detectStatedLocation("What time does the train leave?")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(detectStatedLocation("")).toBeNull();
  });

  it("stops at punctuation", () => {
    expect(detectStatedLocation("I'm in Gion, what should I eat?")).toBe(
      "Gion",
    );
  });
});
