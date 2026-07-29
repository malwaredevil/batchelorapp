import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(relative, import.meta.url)),
    "utf8",
  );
}

describe("platform security invariants", () => {
  it("does not persist screenshot-token identity into the session payload", () => {
    const auth = source("./auth.ts");
    expect(auth).toContain('source: "screenshot-token"');
    expect(auth).toContain("enumerable: false");
    expect(auth).not.toContain("req.session.userId = screenshotUserId");
  });

  it("requires Origin for session-authenticated unsafe methods", () => {
    const csrf = source("./csrf.ts");
    expect(csrf).toContain("Origin header required");
    expect(csrf).toContain("env.replitDomains");
  });
  it("mounts a fail-closed API limiter before the router", () => {
    const app = source("../app.ts");
    const limiter = source("./rateLimit.ts");
    expect(app.indexOf('app.use("/api", apiLimiter)')).toBeGreaterThan(-1);
    expect(app.indexOf('app.use("/api", apiLimiter)')).toBeLessThan(
      app.indexOf('app.use("/api", router)'),
    );
    expect(limiter).toContain('new PostgresRateLimitStore("api")');
    expect(limiter).toContain("passOnStoreError: false");
  });
});
