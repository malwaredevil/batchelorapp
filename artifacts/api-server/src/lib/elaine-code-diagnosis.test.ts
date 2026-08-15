import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock refs
// ---------------------------------------------------------------------------

const {
  mockSelect,
  mockLimit,
  mockInsertReturning,
  mockOnConflictDoNothing,
  mockCallModel,
  mockGetThresholds,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockLimit: vi.fn(),
  mockInsertReturning: vi.fn(),
  mockOnConflictDoNothing: vi.fn(),
  mockCallModel: vi.fn(),
  mockGetThresholds: vi.fn(),
}));

function makeSelectChain(): unknown {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = mockLimit;
  return chain;
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: mockSelect.mockImplementation(() => makeSelectChain()),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: mockOnConflictDoNothing.mockImplementation(
            () => ({ returning: mockInsertReturning }),
          ),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn() })),
        })),
      })),
    },
  };
});

vi.mock("./ai-client", () => ({
  callModel: mockCallModel,
  getModels: vi.fn(async () => ({ advisor: "mock-advisor-model" })),
  getThresholds: mockGetThresholds,
}));

vi.mock("./logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  assertReadable,
  CodeDiagnosisFileError,
  hasSecretLikeContent,
  readAllowlistedSourceFiles,
  maybeDiagnoseRecurringFailure,
  CODE_DIAGNOSIS_FILE_ALLOWLIST,
} from "./elaine-code-diagnosis";

const PATTERN_KEY = "self_heal:claimed_check_without_tool_call";

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect.mockImplementation(() => makeSelectChain());
  mockGetThresholds.mockResolvedValue({
    codeDiagnosisRecurrenceThreshold: 3,
  });
});

describe("elaine-code-diagnosis: path safety", () => {
  it("allows a path under the elaine/ prefix", () => {
    expect(() =>
      assertReadable(
        "artifacts/api-server/src/elaine/runtime/self-heal-policy.ts",
      ),
    ).not.toThrow();
  });

  it("allows a path under the lib/ prefix", () => {
    expect(() =>
      assertReadable("artifacts/api-server/src/lib/elaine-lessons.ts"),
    ).not.toThrow();
  });

  it("rejects a path outside the allowed prefixes", () => {
    expect(() =>
      assertReadable("artifacts/api-server/src/routes/auth.ts"),
    ).toThrow(CodeDiagnosisFileError);
  });

  it("rejects an .env-shaped path even if it were under an allowed prefix", () => {
    expect(() =>
      assertReadable("artifacts/api-server/src/lib/.env.production"),
    ).toThrow(CodeDiagnosisFileError);
  });

  it("rejects any path containing 'secret' or 'credential'", () => {
    expect(() =>
      assertReadable("artifacts/api-server/src/lib/secrets-loader.ts"),
    ).toThrow(CodeDiagnosisFileError);
    expect(() =>
      assertReadable("artifacts/api-server/src/lib/google-credentials.ts"),
    ).toThrow(CodeDiagnosisFileError);
  });

  it("every configured allowlist path passes assertReadable", () => {
    for (const paths of Object.values(CODE_DIAGNOSIS_FILE_ALLOWLIST)) {
      for (const p of paths) {
        expect(() => assertReadable(p)).not.toThrow();
      }
    }
  });
});

describe("elaine-code-diagnosis: secret-content detection", () => {
  it("flags a JWT-shaped string", () => {
    const fakeJwt = "eyJ" + "a".repeat(110);
    expect(hasSecretLikeContent(fakeJwt)).toBe(true);
  });

  it("flags an OpenAI/OpenRouter-shaped key", () => {
    expect(
      hasSecretLikeContent("const key = 'sk-abcdefghijklmnopqrstu';"),
    ).toBe(true);
  });

  it("flags a GitHub PAT-shaped token", () => {
    expect(hasSecretLikeContent("token: ghp_" + "a".repeat(36))).toBe(true);
  });

  it("does not flag ordinary source code", () => {
    expect(
      hasSecretLikeContent(
        "export function add(a: number, b: number) { return a + b; }",
      ),
    ).toBe(false);
  });
});

describe("elaine-code-diagnosis: file allowlist reads real files safely", () => {
  it("reads the two configured self-heal files without tripping the secret guard", () => {
    const files = readAllowlistedSourceFiles(PATTERN_KEY);
    expect(files.map((f) => f.path)).toEqual(
      CODE_DIAGNOSIS_FILE_ALLOWLIST[PATTERN_KEY],
    );
    for (const f of files) {
      expect(f.content.length).toBeGreaterThan(0);
    }
  });

  it("returns an empty array for an unconfigured pattern key", () => {
    expect(readAllowlistedSourceFiles("not-a-real-pattern")).toEqual([]);
  });
});

describe("elaine-code-diagnosis: classifier_doubt allowlist entries (#915)", () => {
  // Confirm that the two new classifier-doubt pattern keys added in #915 are
  // properly configured, pass every path-safety check, and that reading the
  // actual file they point to does not trip the secret-content guard — i.e.
  // classifier.ts contains no secret-shaped content.

  it("classifier_doubt:scheduling is in the allowlist", () => {
    expect(
      CODE_DIAGNOSIS_FILE_ALLOWLIST["classifier_doubt:scheduling"],
    ).toBeDefined();
    expect(
      CODE_DIAGNOSIS_FILE_ALLOWLIST["classifier_doubt:scheduling"].length,
    ).toBeGreaterThan(0);
  });

  it("classifier_doubt:reminder is in the allowlist", () => {
    expect(
      CODE_DIAGNOSIS_FILE_ALLOWLIST["classifier_doubt:reminder"],
    ).toBeDefined();
    expect(
      CODE_DIAGNOSIS_FILE_ALLOWLIST["classifier_doubt:reminder"].length,
    ).toBeGreaterThan(0);
  });

  it("classifier_doubt:scheduling allowlist paths all pass assertReadable", () => {
    for (const p of CODE_DIAGNOSIS_FILE_ALLOWLIST[
      "classifier_doubt:scheduling"
    ]) {
      expect(() => assertReadable(p)).not.toThrow();
    }
  });

  it("classifier_doubt:reminder allowlist paths all pass assertReadable", () => {
    for (const p of CODE_DIAGNOSIS_FILE_ALLOWLIST[
      "classifier_doubt:reminder"
    ]) {
      expect(() => assertReadable(p)).not.toThrow();
    }
  });

  it("reads classifier_doubt:scheduling files without tripping the secret guard", () => {
    const files = readAllowlistedSourceFiles("classifier_doubt:scheduling");
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.content.length).toBeGreaterThan(0);
      expect(hasSecretLikeContent(f.content)).toBe(false);
    }
  });

  it("reads classifier_doubt:reminder files without tripping the secret guard", () => {
    // Both classifier_doubt keys point to classifier.ts; verify it
    // independently so a future allowlist change is caught.
    const files = readAllowlistedSourceFiles("classifier_doubt:reminder");
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.content.length).toBeGreaterThan(0);
      expect(hasSecretLikeContent(f.content)).toBe(false);
    }
  });

  it("both classifier_doubt keys point into the elaine/ source tree", () => {
    for (const key of [
      "classifier_doubt:scheduling",
      "classifier_doubt:reminder",
    ] as const) {
      for (const p of CODE_DIAGNOSIS_FILE_ALLOWLIST[key]) {
        expect(p.startsWith("artifacts/api-server/src/elaine/")).toBe(true);
      }
    }
  });
});

describe("elaine-code-diagnosis: maybeDiagnoseRecurringFailure gating", () => {
  const baseInput = {
    patternKey: PATTERN_KEY,
    lessonId: 42,
    situation: "claimed to have checked something without a tool call",
    takeaway: "never assert a check happened without a corresponding tool call",
  };

  it("does nothing below the recurrence threshold", async () => {
    const result = await maybeDiagnoseRecurringFailure({
      ...baseInput,
      occurrenceCount: 2,
    });
    expect(result).toBeNull();
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockCallModel).not.toHaveBeenCalled();
  });

  it("does nothing when a pending suggestion already exists for the pattern (dedup)", async () => {
    mockLimit.mockResolvedValueOnce([{ id: 1 }]); // hasPendingSuggestion finds one
    const result = await maybeDiagnoseRecurringFailure({
      ...baseInput,
      occurrenceCount: 5,
    });
    expect(result).toBeNull();
    expect(mockCallModel).not.toHaveBeenCalled();
  });

  it("does nothing for a pattern with no configured file allowlist", async () => {
    mockLimit.mockResolvedValueOnce([]); // no pending suggestion
    const result = await maybeDiagnoseRecurringFailure({
      ...baseInput,
      patternKey: "no-such-pattern",
      occurrenceCount: 5,
    });
    expect(result).toBeNull();
    expect(mockCallModel).not.toHaveBeenCalled();
  });

  it("does nothing when the model declines to form a grounded hypothesis", async () => {
    mockLimit.mockResolvedValueOnce([]); // no pending suggestion
    mockCallModel.mockResolvedValueOnce(
      JSON.stringify({
        hasHypothesis: false,
        filesReferenced: [],
        hypothesis: "",
      }),
    );
    const result = await maybeDiagnoseRecurringFailure({
      ...baseInput,
      occurrenceCount: 5,
    });
    expect(result).toBeNull();
    expect(mockInsertReturning).not.toHaveBeenCalled();
  });

  it("persists a suggestion when the model returns a grounded hypothesis", async () => {
    mockLimit.mockResolvedValueOnce([]); // no pending suggestion
    mockCallModel.mockResolvedValueOnce(
      JSON.stringify({
        hasHypothesis: true,
        filesReferenced: [PATTERN_KEY],
        hypothesis: "The regex in self-heal-policy.ts is too narrow.",
      }),
    );
    mockInsertReturning.mockResolvedValueOnce([
      { id: 1, patternKey: PATTERN_KEY, status: "pending" },
    ]);

    const result = await maybeDiagnoseRecurringFailure({
      ...baseInput,
      occurrenceCount: 5,
    });

    expect(result).toEqual(
      expect.objectContaining({ id: 1, status: "pending" }),
    );
    expect(mockOnConflictDoNothing).toHaveBeenCalled();
  });

  it("discards a hypothesis that itself contains secret-shaped content", async () => {
    mockLimit.mockResolvedValueOnce([]); // no pending suggestion
    mockCallModel.mockResolvedValueOnce(
      JSON.stringify({
        hasHypothesis: true,
        filesReferenced: [],
        hypothesis: "Use this key: sk-abcdefghijklmnopqrstu instead.",
      }),
    );

    const result = await maybeDiagnoseRecurringFailure({
      ...baseInput,
      occurrenceCount: 5,
    });

    expect(result).toBeNull();
    expect(mockInsertReturning).not.toHaveBeenCalled();
  });
});
