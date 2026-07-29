from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))

route = "artifacts/api-server/src/routes/slack.ts"
replace_once(
    route,
    '''    if (result === "duplicate") {\n      logger.warn({ eventId }, "slack: duplicate event delivery rejected");\n      res.json({ ok: true, duplicate: true });\n      return;\n    }\n''',
    '''    if (result === "duplicate") {\n      logger.warn({ eventId }, "slack: duplicate event delivery rejected");\n      // Preserve the public Slack acknowledgement contract: callers should not\n      // need to distinguish a first delivery from an idempotent retry.\n      res.json({ ok: true });\n      return;\n    }\n''',
)

test = "artifacts/api-server/src/routes/slack.test.ts"
replace_once(
    test,
    '''vi.mock("../lib/jobs/queue", () => ({\n  enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args),\n}));\n''',
    '''vi.mock("../lib/jobs/queue", () => ({\n  enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args),\n  enqueueJobWithQuery: (_query: unknown, input: unknown) =>\n    mockEnqueueJob(input),\n}));\n''',
)
replace_once(
    test,
    '''    mockEnqueueJob.mockResolvedValue(42);\n    // Pre-seed: appUsers lookup returns one matched user.\n''',
    '''    mockEnqueueJob.mockResolvedValue(42);\n    mockPoolClientQuery.mockImplementation(async (sql: unknown) => {\n      const query = String(sql);\n      if (query.includes("INSERT INTO slack_webhook_deliveries")) {\n        return insertShouldDuplicate.value\n          ? { rows: [] }\n          : { rows: [{ id: "Ev001" }] };\n      }\n      return { rows: [] };\n    });\n    // Pre-seed: appUsers lookup returns one matched user.\n''',
)
