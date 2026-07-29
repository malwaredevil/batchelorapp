import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./slack.ts", import.meta.url)),
  "utf8",
);

describe("Slack ingestion reliability invariants", () => {
  it("claims the delivery and inserts the job in one transaction", () => {
    expect(source).toContain("async function enqueueSlackDelivery");
    expect(source).toContain('await client.query("BEGIN")');
    expect(source).toContain("enqueueJobWithQuery");
    expect(source).toContain('await client.query("COMMIT")');
  });

  it("uses trigger identity rather than a minute bucket", () => {
    expect(source).toContain("slashBody.trigger_id");
    expect(source).not.toContain("minuteBucket");
  });
});
