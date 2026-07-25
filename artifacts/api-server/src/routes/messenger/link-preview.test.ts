/**
 * Integration tests for GET /messenger/link-preview
 *
 * These tests verify that the Microlink fallback correctly parses and returns
 * a title + description for major news/reference sites (BBC, Wikipedia, NYTimes)
 * that block datacenter IP ranges and therefore fail the direct HTML scrape step.
 *
 * HOW THE PARSER IS ACTUALLY EXERCISED
 * -------------------------------------
 * The insert mock echoes back whatever fetchPreview() passes to db.insert().values().
 * This means res.body.title reflects the real parsed Microlink output — not a
 * pre-seeded value. A regression in tryMicrolink() response parsing (e.g., wrong
 * field path, broken JSON shape) would set preview.title = null, which propagates
 * through values() → returning() → res.body.title, and the assertion would fail.
 *
 * HOW TO RE-RUN MANUALLY (smoke-test against the live server):
 *   pnpm --filter @workspace/api-server run test -- link-preview
 *
 * To verify against the real deployed or dev server (requires auth):
 *   curl -s "https://$REPLIT_DEV_DOMAIN/api/messenger/link-preview?url=https://www.bbc.com/news" | jq .
 *   curl -s "https://$REPLIT_DEV_DOMAIN/api/messenger/link-preview?url=https://en.wikipedia.org/wiki/Main_Page" | jq .
 *   curl -s "https://$REPLIT_DEV_DOMAIN/api/messenger/link-preview?url=https://www.nytimes.com/" | jq .
 *
 * Each response should have a non-null `title` field.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// DB mock
//
// We use a stable control object (selectCtrl / insertedValues) rather than
// reassignable `let` variables. Object-property mutation is visible inside
// vi.fn() closures even after Vitest's ESM hoisting transform.
//
// The insert mock echoes back whatever fetchPreview() passes to .values()
// from .returning(). This means res.body.title reflects the REAL parsed
// Microlink output, not a pre-seeded fixture. A regression in tryMicrolink()
// response parsing (wrong field path, broken JSON, etc.) would cause
// preview.title = null → values({ title: null }) → res.body.title = null,
// failing the assertion.
// ---------------------------------------------------------------------------

type PreviewRow = {
  url?: string;
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  fetchedAt?: Date | null;
};

/** Mutate .rows before each test to control what db.select() returns. */
const selectCtrl: { rows: PreviewRow[] } = { rows: [] };

/** Populated by the insert echo-builder; assert after each request. */
const insertedValues: PreviewRow[] = [];

/** Returns a select builder whose limit() resolves to selectCtrl.rows. */
function makeSelectBuilder() {
  // Capture at call time so each test sees its own selectCtrl.rows snapshot.
  const snapshot = selectCtrl.rows;
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(snapshot),
      }),
    }),
  };
}

/** Returns an insert builder that echoes values() back from returning(). */
function makeEchoInsertBuilder() {
  let capturedValues: PreviewRow = {};
  return {
    values(vals: PreviewRow) {
      capturedValues = vals;
      insertedValues.push(vals);
      return {
        onConflictDoUpdate: (_config: unknown) => ({
          returning: () => Promise.resolve([capturedValues]),
        }),
      };
    },
  };
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: vi.fn(makeSelectBuilder),
      insert: vi.fn(makeEchoInsertBuilder),
    },
  };
});

// ---------------------------------------------------------------------------
// fetchHtmlSafe mock — always returns empty string, simulating
// sites that block datacenter IP ranges so the Microlink fallback kicks in.
// ---------------------------------------------------------------------------

const fetchHtmlSafeMock = vi.fn();

vi.mock("../../lib/ssrf-safe-fetch", () => ({
  fetchHtmlSafe: (...args: unknown[]) => fetchHtmlSafeMock(...args),
  assertSsrfSafe: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Logger mock
// ---------------------------------------------------------------------------

vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Microlink response factory — mirrors the real api.microlink.io shape
// ---------------------------------------------------------------------------

function microlinkResponse(title: string, description: string) {
  return {
    status: "success",
    data: {
      title,
      description,
      image: { url: "https://example.com/og.jpg" },
    },
  };
}

// ---------------------------------------------------------------------------
// App under test
// ---------------------------------------------------------------------------

import type { IRouter } from "express";
let linkPreviewRouter: IRouter;

beforeAll(async () => {
  const mod = await import("./link-preview");
  linkPreviewRouter = mod.default;
}, 30_000);

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/messenger", linkPreviewRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /messenger/link-preview — Microlink fallback for blocked domains", () => {
  beforeEach(() => {
    selectCtrl.rows = []; // default: cache miss
    insertedValues.length = 0;
    fetchHtmlSafeMock.mockResolvedValue(""); // direct scrape returns nothing
  });

  it.each([
    {
      label: "BBC News",
      url: "https://www.bbc.com/news",
      expectedTitle: "BBC News - Breaking news, analysis, and more",
      expectedDescription: "Latest news from BBC",
    },
    {
      label: "Wikipedia Main Page",
      url: "https://en.wikipedia.org/wiki/Main_Page",
      expectedTitle: "Wikipedia, the free encyclopedia",
      expectedDescription: "Free encyclopedia built collaboratively",
    },
    {
      label: "NYTimes homepage",
      url: "https://www.nytimes.com/",
      expectedTitle: "The New York Times - Breaking News, US News, World News",
      expectedDescription: "Coverage of news and analysis from NYT",
    },
  ])(
    "returns a non-null title for $label via the Microlink fallback",
    async ({ url, expectedTitle, expectedDescription }) => {
      // selectCtrl.rows = [] already set in beforeEach (cache miss)

      // Mock the global fetch used by tryMicrolink
      const globalFetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify(
              microlinkResponse(expectedTitle, expectedDescription),
            ),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );

      const app = buildApp();
      const res = await request(app)
        .get(`/messenger/link-preview?url=${encodeURIComponent(url)}`)
        .expect(200);

      // title comes from the insert-echo builder reflecting actual parsed
      // Microlink output. Parser regression → preview.title = null → test fails.
      expect(res.body.title).not.toBeNull();
      expect(res.body.title).toBe(expectedTitle);

      // Confirm the parsed data was actually persisted (not a pre-seeded row)
      expect(insertedValues).toHaveLength(1);
      expect(insertedValues[0].title).toBe(expectedTitle);
      expect(insertedValues[0].description).toBe(expectedDescription);

      // Microlink was actually invoked for this allowlisted domain
      const microlinkCalls = globalFetchSpy.mock.calls.filter(([fetchUrl]) =>
        String(fetchUrl).includes("api.microlink.io"),
      );
      expect(microlinkCalls.length).toBeGreaterThan(0);

      // Direct HTML scrape was attempted first (and returned empty)
      expect(fetchHtmlSafeMock).toHaveBeenCalledWith(url, expect.any(Number));

      globalFetchSpy.mockRestore();
    },
  );

  it("returns title from cache without calling Microlink when a cached row exists", async () => {
    const url = "https://www.bbc.com/sport";
    // imageUrl must be non-null: the route treats imageUrl=null on an
    // allowlisted domain as stale (isMicrolinkStale=true) and re-fetches.
    // fetchedAt must be recent: the route treats entries older than 30 days
    // as expired (isExpired=true) and re-fetches.
    const cachedRow: PreviewRow = {
      url,
      title: "BBC Sport - Cached",
      description: "Cached description",
      imageUrl: "https://example.com/og.jpg",
      fetchedAt: new Date(),
    };

    // Set cache-hit state before the request
    selectCtrl.rows = [cachedRow];

    // Make fetch reject so any accidental Microlink call is hard-detectable
    const globalFetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("fetch must not be called on a cache hit"));

    const app = buildApp();
    const res = await request(app)
      .get(`/messenger/link-preview?url=${encodeURIComponent(url)}`)
      .expect(200);

    expect(res.body.title).toBe("BBC Sport - Cached");

    // No insert should have occurred on a cache hit
    expect(insertedValues).toHaveLength(0);

    // fetch must not have been called at all
    expect(globalFetchSpy).not.toHaveBeenCalled();

    globalFetchSpy.mockRestore();
  });

  it("persists and returns null title when both direct scrape and Microlink fail", async () => {
    const url = "https://www.bbc.com/weather";

    // Cache miss already set in beforeEach; Microlink returns 503
    const globalFetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    const app = buildApp();
    const res = await request(app)
      .get(`/messenger/link-preview?url=${encodeURIComponent(url)}`)
      .expect(200);

    // fetchPreview() → { title: null } → insert echoes null → res.body.title null
    expect(res.body.title).toBeNull();
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0].title).toBeNull();

    globalFetchSpy.mockRestore();
  });

  it("does NOT call Microlink for domains not in the allowlist", async () => {
    const url = "https://www.example.com/article";

    // example.com is not allowlisted — reject fetch to make any call detectable
    const globalFetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(
        new Error("fetch must not be called for non-allowlisted domains"),
      );

    const app = buildApp();
    const res = await request(app)
      .get(`/messenger/link-preview?url=${encodeURIComponent(url)}`)
      .expect(200);

    // No Microlink call and no title
    expect(globalFetchSpy).not.toHaveBeenCalled();
    expect(res.body.title).toBeNull();

    globalFetchSpy.mockRestore();
  });

  it("returns 400 for missing url parameter", async () => {
    const app = buildApp();
    await request(app).get("/messenger/link-preview").expect(400);
  });

  it("returns 400 for an invalid URL", async () => {
    const app = buildApp();
    await request(app).get("/messenger/link-preview?url=not-a-url").expect(400);
  });

  it("returns 400 for a non-http URL", async () => {
    const app = buildApp();
    await request(app)
      .get("/messenger/link-preview?url=ftp%3A%2F%2Fexample.com")
      .expect(400);
  });
});
