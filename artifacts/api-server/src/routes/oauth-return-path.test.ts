import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { sanitizeReturnPath } from "@workspace/web-core/return-path";

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: {},
}));
vi.mock("../middleware/auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import gmailRouter from "./gmail";
import calendarRouter from "./travels/google-calendar";

const unsafePaths = [
  "//untrusted.invalid",
  "/\\untrusted.invalid",
  "/\n/untrusted.invalid",
  "/\t/untrusted.invalid",
  "/path\\untrusted.invalid",
  "https://untrusted.invalid",
  "javascript:alert(1)",
  "",
];

describe("shared same-origin return paths", () => {
  it.each(unsafePaths)("rejects unsafe return path %j", (path) => {
    expect(sanitizeReturnPath(path)).toBeNull();
  });

  it.each([null, undefined, [], {}, 42])(
    "rejects non-string input %j",
    (value) => {
      expect(sanitizeReturnPath(value)).toBeNull();
    },
  );

  it.each(["/", "/modules/travels", "/gmail?search=tea%20time#inbox"])(
    "preserves safe path %j",
    (path) => expect(sanitizeReturnPath(path)).toBe(path),
  );
});

describe.each([
  {
    name: "Gmail",
    router: gmailRouter,
    mount: "/api/gmail",
    callback: "/api/gmail/callback",
    cookie: "hub.gmail_oauth_state",
    fallback: "/gmail",
  },
  {
    name: "Google Calendar",
    router: calendarRouter,
    mount: "/api/travels",
    callback: "/api/travels/google-calendar/callback",
    cookie: "travels.gcal_oauth_state",
    fallback: "/account",
  },
])(
  "$name OAuth callback redirects",
  ({ router, mount, callback, cookie, fallback }) => {
    function appForPath(path: string) {
      const app = express();
      app.use((req, _res, next) => {
        req.session = { userId: 7 } as typeof req.session;
        req.signedCookies = {
          [cookie]: `state:${Buffer.from(path).toString("base64url")}`,
        };
        next();
      });
      app.use(mount, router);
      return app;
    }

    it.each(unsafePaths)(
      "uses a same-origin fallback for %j from a signed state cookie",
      async (path) => {
        const response = await request(appForPath(path)).get(callback);
        expect(response.status).toBe(302);
        expect(response.headers.location).toMatch(
          new RegExp(`^${fallback}\\?`),
        );
        expect(
          new URL(response.headers.location, "https://app.example").origin,
        ).toBe("https://app.example");
      },
    );

    it("preserves a valid cross-app return path", async () => {
      const response = await request(appForPath("/modules/travels")).get(
        callback,
      );
      expect(response.status).toBe(302);
      expect(response.headers.location).toMatch(/^\/modules\/travels\?/);
    });
  },
);
