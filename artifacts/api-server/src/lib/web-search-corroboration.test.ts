import { describe, expect, it } from "vitest";
import {
  assessCorroboration,
  buildWebSearchToolResult,
  extractCitationDomains,
} from "./web-search";

// ---------------------------------------------------------------------------
// extractCitationDomains
// ---------------------------------------------------------------------------
describe("extractCitationDomains", () => {
  it("returns unique hostnames without www. prefix", () => {
    const domains = extractCitationDomains([
      "https://www.example.com/page",
      "https://example.com/other",
      "https://another.org/article",
    ]);
    expect(domains).toEqual(new Set(["example.com", "another.org"]));
  });

  it("ignores malformed URLs", () => {
    const domains = extractCitationDomains([
      "not-a-url",
      "javascript:alert(1)",
      "https://good.example/page",
    ]);
    expect(domains).toEqual(new Set(["good.example"]));
  });

  it("returns an empty set for an empty list", () => {
    expect(extractCitationDomains([])).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// assessCorroboration — prerequisite checks (single_source / no_reliable_answer)
// ---------------------------------------------------------------------------
describe("assessCorroboration — source prerequisites", () => {
  it('returns "no_reliable_answer" when neither search finds an answer', () => {
    expect(
      assessCorroboration(
        { answer: "", citations: [] },
        { answer: "", citations: [] },
      ),
    ).toBe("no_reliable_answer");
  });

  it('returns "no_reliable_answer" when both answers are whitespace-only', () => {
    expect(
      assessCorroboration(
        { answer: "   \n", citations: [] },
        { answer: "\t  ", citations: [] },
      ),
    ).toBe("no_reliable_answer");
  });

  it('returns "single_source" when only the primary search finds an answer', () => {
    expect(
      assessCorroboration(
        {
          answer: "Primary has an answer.",
          citations: ["https://a.example/x", "https://b.example/y"],
        },
        { answer: "", citations: [] },
      ),
    ).toBe("single_source");
  });

  it('returns "single_source" when only the verification search finds an answer', () => {
    expect(
      assessCorroboration(
        { answer: "   ", citations: [] },
        {
          answer: "Verification found something.",
          citations: ["https://a.example/x"],
        },
      ),
    ).toBe("single_source");
  });

  it('returns "single_source" when both answer but citations span only one domain', () => {
    expect(
      assessCorroboration(
        { answer: "Claim.", citations: ["https://singlesource.example/a"] },
        {
          answer: "Same claim.",
          citations: ["https://singlesource.example/b"],
        },
        "agree",
      ),
    ).toBe("single_source");
  });

  it('returns "single_source" when both answer but have zero citations', () => {
    expect(
      assessCorroboration(
        { answer: "Claimed without sources.", citations: [] },
        { answer: "Also claimed without sources.", citations: [] },
        "agree",
      ),
    ).toBe("single_source");
  });
});

// ---------------------------------------------------------------------------
// assessCorroboration — corroborated vs conflicting (requires 2+ domains)
// ---------------------------------------------------------------------------
describe("assessCorroboration — agreement verdict", () => {
  const primary = {
    answer: "The capital of France is Paris.",
    citations: ["https://britannica.com/Paris"],
  };
  const secondary = {
    answer: "Paris is the capital and largest city of France.",
    citations: ["https://bbc.co.uk/news/france"],
  };

  it('returns "corroborated" when verdict is "agree" and ≥ 2 distinct domains', () => {
    expect(assessCorroboration(primary, secondary, "agree")).toBe(
      "corroborated",
    );
  });

  it('returns "corroborated" when no verdict supplied and ≥ 2 distinct domains (conservative default)', () => {
    // Without a verdict the function cannot detect conflict — it conservatively
    // returns corroborated. Callers that need conflict detection must pass the
    // verdict from checkAnswerAgreement().
    expect(assessCorroboration(primary, secondary)).toBe("corroborated");
  });

  it('returns "conflicting" when verdict is "conflict" even with ≥ 2 distinct domains', () => {
    const contradictoryPrimary = {
      answer: "This drug has no known serious side effects.",
      citations: ["https://pharmasite.example/drug-info"],
    };
    const contradictorySecondary = {
      answer:
        "Several case reports link the drug to elevated liver enzyme levels.",
      citations: ["https://medjournal.example/case-report"],
    };
    expect(
      assessCorroboration(
        contradictoryPrimary,
        contradictorySecondary,
        "conflict",
      ),
    ).toBe("conflicting");
  });

  it('returns "conflicting" when verdict is "partial" (partial agreement treated as insufficient)', () => {
    expect(assessCorroboration(primary, secondary, "partial")).toBe(
      "conflicting",
    );
  });

  it('returns "corroborated" when domains only appear in one search each but total ≥ 2 and verdict is agree', () => {
    expect(
      assessCorroboration(
        {
          answer: "Some verified fact.",
          citations: ["https://siteA.example/page"],
        },
        {
          answer: "Same fact, confirmed.",
          citations: ["https://siteB.example/article"],
        },
        "agree",
      ),
    ).toBe("corroborated");
  });
});

// ---------------------------------------------------------------------------
// buildWebSearchToolResult — end-to-end handler text (proves conflicting
// tool results cannot yield a normal-confidence reply)
// ---------------------------------------------------------------------------
describe("buildWebSearchToolResult", () => {
  it("returns a no-results message when both answers are empty", () => {
    const text = buildWebSearchToolResult("", "", [], "no_reliable_answer");
    expect(text).toBe("No results found for this search.");
  });

  it("includes both answers and the corroboration note", () => {
    const text = buildWebSearchToolResult(
      "Paris is the capital of France.",
      "France's capital is Paris.",
      ["https://britannica.com/Paris", "https://bbc.co.uk/news"],
      "corroborated",
    );
    expect(text).toContain("Primary search result:");
    expect(text).toContain("Paris is the capital of France.");
    expect(text).toContain("Verification search result:");
    expect(text).toContain("France's capital is Paris.");
    expect(text).toContain("[CORROBORATION: corroborated]");
    expect(text).toContain("[1] https://britannica.com/Paris");
  });

  it('embeds "[CORROBORATION: conflicting]" in the tool result for contradictory sources', () => {
    // This is the critical handler-level check: when sources conflict, the
    // string the model receives MUST contain the conflicting status, which the
    // WEB SEARCH CORROBORATION prompt rules then prohibit from yielding a
    // normal-confidence response.
    const text = buildWebSearchToolResult(
      "This drug has no known serious side effects.",
      "Several case reports link the drug to elevated liver enzyme levels.",
      [
        "https://pharmasite.example/drug-info",
        "https://medjournal.example/case-report",
      ],
      "conflicting",
    );
    expect(text).toContain("[CORROBORATION: conflicting]");
    // Both perspectives must be present so the model can surface the disagreement.
    expect(text).toContain("no known serious side effects");
    expect(text).toContain("elevated liver enzyme levels");
  });

  it('embeds "[CORROBORATION: single_source]" when only one source is found', () => {
    const text = buildWebSearchToolResult(
      "Some single-source claim.",
      "",
      ["https://onesource.example/page"],
      "single_source",
    );
    expect(text).toContain("[CORROBORATION: single_source]");
    expect(text).toContain("(verification search found no answer)");
  });

  it('embeds "[CORROBORATION: no_reliable_answer]" when primary answers but secondary is empty and status reflects it', () => {
    const text = buildWebSearchToolResult(
      "Something was found.",
      "",
      [],
      "no_reliable_answer",
    );
    expect(text).toContain("[CORROBORATION: no_reliable_answer]");
  });

  it("omits the Sources section when there are no citations", () => {
    const text = buildWebSearchToolResult(
      "An answer with no citations.",
      "Another answer.",
      [],
      "corroborated",
    );
    expect(text).not.toContain("Sources:");
    expect(text).toContain("[CORROBORATION: corroborated]");
  });
});
