import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({ env: { voyageApiKey: "test-voyage-key" } }));
vi.mock("./app-config", () => ({ getConfig: vi.fn(async () => 10_000) }));
vi.mock("./elaine-config", () => ({ getElaineGlobalConfig: vi.fn() }));
vi.mock("./retry", () => ({
  withRetry: async (fn: () => Promise<unknown>) => fn(),
}));

import { env } from "./env";
import { getElaineGlobalConfig } from "./elaine-config";
import { rerankCandidates } from "./reranker";

const documents = [
  { id: 42, text: "solid red wool" },
  { id: 71, text: "blue floral cotton" },
];
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  env.voyageApiKey = "test-voyage-key";
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(getElaineGlobalConfig).mockResolvedValue({
    models: { rerank: "rerank-3" },
  } as Awaited<ReturnType<typeof getElaineGlobalConfig>>);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [
        { index: 0, relevance_score: 0.1 },
        { index: 1, relevance_score: 0.9 },
      ],
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("configured Voyage reranking", () => {
  it("sends rerank-3 and translates scores back to collection IDs", async () => {
    expect(await rerankCandidates("blue floral cotton", documents, 10)).toEqual(
      [71, 42],
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      model: "rerank-3",
      query: "blue floral cotton",
      documents: documents.map((d) => d.text),
      top_k: 2,
      return_documents: false,
    });
  });

  it("honors a later owner rollback on the actual provider request", async () => {
    vi.mocked(getElaineGlobalConfig).mockResolvedValue({
      models: { rerank: "rerank-2.5" },
    } as Awaited<ReturnType<typeof getElaineGlobalConfig>>);
    await rerankCandidates("blue floral cotton", documents, 1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe(
      "rerank-2.5",
    );
  });

  it("preserves the original ordering on provider failure", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    expect(await rerankCandidates("query", documents, 2)).toEqual([42, 71]);
    fetchMock.mockRejectedValue(new Error("timeout"));
    expect(await rerankCandidates("query", documents, 2)).toEqual([42, 71]);
  });

  it("does no paid work for empty input or a missing credential", async () => {
    expect(await rerankCandidates("query", [], 2)).toEqual([]);
    env.voyageApiKey = undefined;
    expect(await rerankCandidates("query", documents, 2)).toEqual([42, 71]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getElaineGlobalConfig).not.toHaveBeenCalled();
  });
});
