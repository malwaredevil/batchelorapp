import { describe, expect, it, vi } from "vitest";
import {
  discoverAppOperations,
  executeAppOperation,
} from "./app-operation-tools";

describe("Elaine universal app-operation bridge", () => {
  it("discovers reviewed operations with their exact input contract", () => {
    const result = JSON.parse(
      discoverAppOperations({
        query: "reservation",
        access: "action",
        limit: 6,
      }),
    ) as {
      operations: Array<{ operationId: string; path: string; access: string }>;
    };

    expect(result.operations.length).toBeGreaterThan(0);
    expect(result.operations.every(({ access }) => access === "action")).toBe(
      true,
    );
    expect(
      result.operations.some(({ operationId }) =>
        operationId.includes("Reservation"),
      ),
    ).toBe(true);
  });

  it("executes only the catalog method and local API path", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 44, name: "Invented quilt" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const result = await executeAppOperation(
      {
        operationId: "updateQuilt",
        pathParams: { id: 44 },
        body: { name: "Invented quilt" },
      },
      "action",
      {
        sessionCookie: "session=invented",
        localPort: 5000,
        fetchImpl: fetchImpl as typeof fetch,
      },
    );

    expect(result.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = (
      fetchImpl.mock.calls as unknown as Array<[unknown, RequestInit]>
    )[0]!;
    expect(String(url)).toBe("http://127.0.0.1:5000/api/quilting/quilts/44");
    expect(init).toMatchObject({
      method: "PATCH",
      redirect: "manual",
      body: JSON.stringify({ name: "Invented quilt" }),
    });
  });

  it("fails closed for dedicated, unknown, mismatched, or unauthenticated operations", async () => {
    await expect(
      executeAppOperation(
        { operationId: "getPottery", pathParams: { id: 1 } },
        "read",
        { sessionCookie: "session=invented", localPort: 5000 },
      ),
    ).rejects.toThrow("not an approved read capability");

    await expect(
      executeAppOperation(
        { operationId: "updateQuilt", pathParams: { id: 1 } },
        "read",
        { sessionCookie: "session=invented", localPort: 5000 },
      ),
    ).rejects.toThrow("not an approved read capability");

    expect(
      await executeAppOperation({ operationId: "getJobsHealth" }, "read", {
        localPort: 5000,
      }),
    ).toMatchObject({ status: 401 });
  });

  it("rejects fields outside the generated operation contract before fetching", async () => {
    const fetchImpl = vi.fn();
    const context = {
      sessionCookie: "session=invented",
      localPort: 5000,
      fetchImpl: fetchImpl as typeof fetch,
    };

    await expect(
      executeAppOperation(
        { operationId: "listJobs", query: { unexpected: "value" } },
        "read",
        context,
      ),
    ).rejects.toThrow("Unknown query parameter");
    await expect(
      executeAppOperation({ operationId: "getLinkPreview" }, "read", context),
    ).rejects.toThrow("Missing query parameter");
    await expect(
      executeAppOperation(
        {
          operationId: "updateQuilt",
          pathParams: { id: 44, extra: 1 },
          body: { name: "Invented quilt" },
        },
        "action",
        context,
      ),
    ).rejects.toThrow("Unknown path parameter");
    await expect(
      executeAppOperation(
        {
          operationId: "updateQuilt",
          pathParams: { id: 44 },
        },
        "action",
        context,
      ),
    ).rejects.toThrow("requires a JSON body");
    await expect(
      executeAppOperation(
        { operationId: "getJobsHealth", body: { unexpected: true } },
        "read",
        context,
      ),
    ).rejects.toThrow("does not accept a JSON body");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("redacts sensitive response keys before returning data to the model", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "ok",
            accessToken: "must-not-leak",
            nested: { password: "must-not-leak", count: 2 },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );

    const result = await executeAppOperation(
      { operationId: "getJobsHealth" },
      "read",
      {
        sessionCookie: "session=invented",
        localPort: 5000,
        fetchImpl: fetchImpl as typeof fetch,
      },
    );

    expect(result.body).toEqual({ status: "ok", nested: { count: 2 } });
  });
});
