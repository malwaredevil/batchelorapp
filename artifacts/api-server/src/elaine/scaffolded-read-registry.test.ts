/**
 * Contract tests for the scaffolded read-tool dispatch registry that index.ts's
 * model-visible hard-tool dispatcher consults (see scaffolded-read-registry.ts).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  SCAFFOLDED_READ_TOOL_EXECUTORS,
  executeScaffoldedReadTool,
  isScaffoldedReadTool,
} from "./scaffolded-read-registry";

describe("scaffolded-read-registry", () => {
  afterEach(() => {
    delete SCAFFOLDED_READ_TOOL_EXECUTORS["__test_probe_tool"];
  });

  it("unknown tools are not claimed and fall through to 'Unsupported tool.'", async () => {
    expect(isScaffoldedReadTool("nonexistent_tool")).toBe(false);
    await expect(
      executeScaffoldedReadTool("nonexistent_tool", "{}", 1),
    ).resolves.toBe("Unsupported tool.");
  });

  it("a registered tool dispatches through the registry with args and userId", async () => {
    SCAFFOLDED_READ_TOOL_EXECUTORS["__test_probe_tool"] = async (
      args,
      userId,
    ) => `ok:${args}:${userId}`;
    expect(isScaffoldedReadTool("__test_probe_tool")).toBe(true);
    await expect(
      executeScaffoldedReadTool("__test_probe_tool", '{"q":1}', 42),
    ).resolves.toBe('ok:{"q":1}:42');
  });

  it("does not treat Object.prototype members as registered tools", () => {
    expect(isScaffoldedReadTool("toString")).toBe(false);
    expect(isScaffoldedReadTool("constructor")).toBe(false);
  });
});
