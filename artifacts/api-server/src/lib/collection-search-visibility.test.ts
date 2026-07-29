import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./collection-search.ts", import.meta.url)),
  "utf8",
);

describe("collection search visibility contract", () => {
  it("requires a visibility predicate for every semantic search", () => {
    expect(source).toContain("visibilityWhere: SQL");
    expect(source).not.toContain("extraWhere?: SQL");
    expect(source.match(/and \${visibilityWhere}/g)).toHaveLength(2);
  });

  it("drops candidates that disappear before document hydration", () => {
    expect(source).toContain(
      "const visibleCandidateIds = candidateIds.filter((id) => byId.has(id))",
    );
  });
});
