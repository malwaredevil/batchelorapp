import { describe, expect, it } from "vitest";
import { rankElaineMemories } from "./memory-policy";

const now = new Date("2026-07-30T12:00:00.000Z");

function memory(
  overrides: Partial<
    Parameters<typeof rankElaineMemories>[0]["memories"][number]
  > = {},
) {
  return {
    id: 1,
    content: "John prefers aisle seats on long flights",
    type: "fact",
    scope: "personal",
    ownerUserId: 7,
    active: true,
    deletedAt: null,
    expiresAt: null,
    source: "explicit_user",
    lastConfirmedAt: new Date("2026-07-29T12:00:00.000Z"),
    confidence: "1.000",
    correctionOfId: null,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-29T12:00:00.000Z"),
    ...overrides,
  };
}

describe("Elaine memory policy", () => {
  it("enforces personal ownership, active state, and expiry", () => {
    const result = rankElaineMemories({
      query: "flight seat preference",
      userId: 7,
      now,
      memories: [
        memory(),
        memory({ id: 2, ownerUserId: 8 }),
        memory({ id: 3, active: false }),
        memory({ id: 4, expiresAt: new Date("2026-07-01T00:00:00.000Z") }),
      ],
    });

    expect(result.map(({ id }) => id)).toEqual([1]);
  });

  it("lets explicit corrections replace stale contradictory memories", () => {
    const result = rankElaineMemories({
      query: "flight seat preference",
      userId: 7,
      now,
      memories: [
        memory({ id: 1, content: "John prefers aisle seats" }),
        memory({
          id: 2,
          content: "John now prefers window seats",
          correctionOfId: 1,
        }),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 2,
      content: "John now prefers window seats",
    });
  });

  it("ranks relevant confirmed memory above unrelated generated content", () => {
    const result = rankElaineMemories({
      query: "What seat should I select for John's flight?",
      userId: 7,
      now,
      memories: [
        memory(),
        memory({
          id: 2,
          content: "The household owns blue pottery",
          scope: "household",
          ownerUserId: null,
          source: "assistant_generated",
          confidence: "0.400",
        }),
      ],
    });

    expect(result[0]?.id).toBe(1);
  });
});
