import { describe, expect, it, vi, type Mock } from "vitest";
import { checkAnswerAgreement } from "./web-search";

// Mock the ai-client module so no real model calls are made.
vi.mock("./ai-client", () => ({
  getModels: vi.fn().mockResolvedValue({ fastVision: "test-model" }),
  callModel: vi.fn(),
}));

// Lazy import after mock is registered.
async function getCallModel(): Promise<Mock> {
  const mod = await import("./ai-client");
  return mod.callModel as unknown as Mock;
}

function makeCompletion(content: string | null) {
  return { choices: [{ message: { content } }] };
}

describe("checkAnswerAgreement — fail-closed contract", () => {
  it('returns "agree" when the model says AGREE', async () => {
    const callModel = await getCallModel();
    callModel.mockImplementation(
      async (
        _model: unknown,
        fn: (client: unknown, model: string) => unknown,
      ) =>
        fn(
          {
            chat: {
              completions: { create: async () => makeCompletion("AGREE") },
            },
          },
          "test-model",
        ),
    );
    expect(
      await checkAnswerAgreement(
        "Paris is the capital.",
        "Paris is France's capital.",
      ),
    ).toBe("agree");
  });

  it('returns "partial" when the model says PARTIAL', async () => {
    const callModel = await getCallModel();
    callModel.mockImplementation(
      async (
        _model: unknown,
        fn: (client: unknown, model: string) => unknown,
      ) =>
        fn(
          {
            chat: {
              completions: { create: async () => makeCompletion("PARTIAL") },
            },
          },
          "test-model",
        ),
    );
    expect(
      await checkAnswerAgreement("Some claim.", "A different perspective."),
    ).toBe("partial");
  });

  it('returns "conflict" when the model says CONFLICT', async () => {
    const callModel = await getCallModel();
    callModel.mockImplementation(
      async (
        _model: unknown,
        fn: (client: unknown, model: string) => unknown,
      ) =>
        fn(
          {
            chat: {
              completions: { create: async () => makeCompletion("CONFLICT") },
            },
          },
          "test-model",
        ),
    );
    expect(
      await checkAnswerAgreement(
        "Drug is safe.",
        "Drug has serious side effects.",
      ),
    ).toBe("conflict");
  });

  it('returns "conflict" (not "agree") when the model call throws — fail closed', async () => {
    const callModel = await getCallModel();
    callModel.mockImplementation(async () => {
      throw new Error("Rate limit exceeded");
    });
    // Must NOT return "agree" — that would allow Elaine to state the claim
    // with normal confidence even though verification was unavailable.
    const result = await checkAnswerAgreement(
      "Drug has no known side effects.",
      "Drug is linked to liver damage.",
    );
    expect(result).toBe("conflict");
    expect(result).not.toBe("agree");
  });

  it('returns "conflict" (not "agree") when the model returns an unexpected/empty response — fail closed', async () => {
    const callModel = await getCallModel();
    callModel.mockImplementation(
      async (
        _model: unknown,
        fn: (client: unknown, model: string) => unknown,
      ) =>
        fn(
          {
            chat: {
              completions: { create: async () => makeCompletion("DUNNO") },
            },
          },
          "test-model",
        ),
    );
    const result = await checkAnswerAgreement(
      "Drug has no known side effects.",
      "Drug is linked to liver damage.",
    );
    expect(result).toBe("conflict");
    expect(result).not.toBe("agree");
  });

  it('returns "conflict" when the model returns null content — fail closed', async () => {
    const callModel = await getCallModel();
    callModel.mockImplementation(
      async (
        _model: unknown,
        fn: (client: unknown, model: string) => unknown,
      ) =>
        fn(
          {
            chat: { completions: { create: async () => makeCompletion(null) } },
          },
          "test-model",
        ),
    );
    const result = await checkAnswerAgreement("Claim A.", "Claim B.");
    expect(result).toBe("conflict");
    expect(result).not.toBe("agree");
  });
});
