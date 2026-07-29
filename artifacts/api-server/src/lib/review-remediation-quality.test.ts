import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(relative: string) {
  return readFileSync(
    fileURLToPath(new URL(relative, import.meta.url)),
    "utf8",
  );
}

describe("review remediation quality contracts", () => {
  it("bounds compressed uploads, decoded pixels, and output dimensions", () => {
    const upload = source("../../../../../lib/upload-validation/src/index.ts");
    expect(upload).toContain("25 * 1024 * 1024");
    expect(upload).toContain("MAX_INPUT_PIXELS = 50_000_000");
    expect(upload).toContain("MAX_STORAGE_DIMENSION = 4096");
    expect(upload).toContain("MAX_CONCURRENT_IMAGE_TRANSFORMS = 2");
  });

  it("uses optimistic versions for external channel histories", () => {
    expect(source("../../routes/agentphone.ts")).toContain(
      "eq(agentphoneConversations.version, current.version)",
    );
    expect(source("../../routes/elaine-email.ts")).toContain(
      "eq(elaineEmailConversations.version, conversation.version)",
    );
  });

  it("uses transactions for messenger multi-row writes", () => {
    const messenger = source("../../routes/messenger/conversations.ts");
    expect(
      (messenger.match(/db\.transaction/g) ?? []).length,
    ).toBeGreaterThanOrEqual(3);
    expect(messenger).not.toContain("sql.raw(`ARRAY[");
  });
});
