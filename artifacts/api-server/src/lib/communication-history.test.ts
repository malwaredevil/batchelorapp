import { describe, expect, it } from "vitest";
import { appendCommunicationHistoryTurn } from "./communication-history";

describe("appendCommunicationHistoryTurn", () => {
  it("records the actual reply without changing the saved message or mutating history", () => {
    const history = [{ role: "user" as const, content: "Earlier message" }];
    expect(
      appendCommunicationHistoryTurn(history, "Hello?", "Your reminder."),
    ).toEqual([
      ...history,
      { role: "user", content: "Hello?" },
      { role: "assistant", content: "Your reminder." },
    ]);
    expect(history).toHaveLength(1);
  });

  it("uses the same bounded history for deterministic and model-generated replies", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: "assistant" as const,
      content: `Earlier ${i}`,
    }));
    const result = appendCommunicationHistoryTurn(
      history,
      "Hello?",
      "Saved opening",
    );
    expect(result).toHaveLength(20);
    expect(result[0]?.content).toBe("Earlier 2");
    expect(result.at(-1)?.content).toBe("Saved opening");
  });
});
