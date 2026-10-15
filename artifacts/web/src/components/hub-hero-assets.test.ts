import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("approved hub hero artwork", () => {
  it("keeps the Magnets refrigerator photograph instead of the old illustration", () => {
    // Keep this separate from link-registration tests: an unrelated update
    // previously reverted both the image URL and its link-test expectation.
    const config = readFileSync(
      resolve(import.meta.dirname, "../config/apps.tsx"),
      "utf8",
    );
    const magnetsCard = config.match(
      /\/\/ scaffold:begin:magnets([\s\S]*?)\/\/ scaffold:end:magnets/,
    )?.[1];
    expect(magnetsCard).toBeDefined();
    expect(magnetsCard).toContain(
      "image: `${base}images/magnets-collection.png`",
    );
    expect(magnetsCard).not.toContain("magnets-collection.svg");

    const photograph = readFileSync(
      resolve(
        import.meta.dirname,
        "../../public/images/magnets-collection.png",
      ),
    );
    // Fingerprint the approved photo so a stale binary replacement fails too.
    expect(createHash("sha256").update(photograph).digest("hex")).toBe(
      "6b382aaf07102d7c584d88bbabe22c0760be96020aabc0ba84de87f7774cf114",
    );
  });
});
