import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ai-client", () => ({
  callModel: vi.fn(),
  getModels: vi.fn(),
}));

import { callModel, getModels } from "../ai-client";
import { analyzeMagnetImage } from "./openai";

const mockModels = { fastVision: "mock-vision-model" };

describe("analyzeMagnetImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getModels as ReturnType<typeof vi.fn>).mockResolvedValue(mockModels);
  });

  it("parses a well-formed AI response", async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              name: "Paris Eiffel Tower Magnet",
              description:
                "A souvenir fridge magnet featuring the Eiffel Tower.",
              dominantColors: ["blue", "gold", "white"],
              motifs: ["Eiffel Tower", "Paris"],
              categories: ["Destination", "Landmark"],
            }),
          },
        },
      ],
    };

    (callModel as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _model: unknown,
        fn: (client: unknown, model: string) => Promise<unknown>,
      ) => {
        return fn(
          {
            chat: {
              completions: {
                create: async () => mockResponse,
              },
            },
          },
          "mock-vision-model",
        );
      },
    );

    const result = await analyzeMagnetImage(["data:image/jpeg;base64,abc"], []);

    expect(result.name).toBe("Paris Eiffel Tower Magnet");
    expect(result.description).toContain("Eiffel Tower");
    expect(result.dominantColors).toEqual(["blue", "gold", "white"]);
    expect(result.motifs).toContain("Paris");
    expect(result.categories).toContain("Destination");
  });

  it("falls back to 'Untitled magnet' when name is missing", async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              description: null,
              dominantColors: [],
              motifs: [],
              categories: [],
            }),
          },
        },
      ],
    };

    (callModel as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _model: unknown,
        fn: (client: unknown, model: string) => Promise<unknown>,
      ) => {
        return fn(
          {
            chat: {
              completions: {
                create: async () => mockResponse,
              },
            },
          },
          "mock-vision-model",
        );
      },
    );

    const result = await analyzeMagnetImage(["data:image/jpeg;base64,abc"], []);

    expect(result.name).toBe("Untitled magnet");
    expect(result.description).toBeNull();
    expect(result.dominantColors).toEqual([]);
    expect(result.categories).toEqual([]);
  });

  it("caps categories to 4", async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              name: "Test Magnet",
              description: null,
              dominantColors: [],
              motifs: [],
              categories: ["A", "B", "C", "D", "E", "F"],
            }),
          },
        },
      ],
    };

    (callModel as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _model: unknown,
        fn: (client: unknown, model: string) => Promise<unknown>,
      ) => {
        return fn(
          {
            chat: {
              completions: {
                create: async () => mockResponse,
              },
            },
          },
          "mock-vision-model",
        );
      },
    );

    const result = await analyzeMagnetImage(["data:image/jpeg;base64,abc"], []);

    expect(result.categories.length).toBeLessThanOrEqual(4);
  });
});
