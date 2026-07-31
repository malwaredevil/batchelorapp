# Elaine universal Batchelor App copilot

This document describes the consolidated capability-parity and trace-evaluation
wave tracked by issue #351. It extends Elaine without removing her dedicated
travel, collection, Office, notification, memory, research, widget, or
navigation tools.

## Capability architecture

Elaine now has two complementary capability layers:

1. **Dedicated tools** remain the preferred implementation for common and rich
   workflows. They provide domain-specific validation, labels, widgets,
   provenance, and deterministic responses.
2. **The universal app-operation bridge** covers reviewed authenticated JSON
   operations that do not have a dedicated Elaine tool. It discovers a compact
   operation contract from a generated OpenAPI catalog, performs read-only
   operations automatically, and submits mutations through Elaine's existing
   confirmation and audit flow.

The bridge calls the same local Express API used by the website. It forwards
the current authenticated web session and therefore reuses route validation,
owner checks, user-scoped OAuth checks, domain rules, provider clients, job
logic, and response contracts. It does not write tables directly and does not
duplicate route business logic.

The model supplies only a reviewed `operationId` and its path/query/body values.
It cannot supply a URL, host, HTTP method, session identity, or content type.
The server resolves the method and local `/api` path from the generated catalog,
encodes path/query values, limits request and response sizes, rejects redirects
and binary content, and removes sensitive response keys before returning
results to the model.

## Explicit exclusions

The bridge is available only in Elaine's authenticated web chat. It is not
included in SMS, voice, email, Slack, or Messenger restricted-channel tool
allowlists.

Interactive authentication and browser permission operations remain user
flows. Binary upload/download, device camera capture, generated image/PDF
responses, webhooks, and unauthenticated health probes are also excluded from
the JSON bridge. Authenticated owner-only Control Panel operations remain
guarded by their existing route-level owner checks. Elaine may still reason
over supported chat attachments and direct the user to an appropriate screen.

`website-operation-inventory.json` is the reviewed policy source.
`app-operation-catalog.generated.ts` is generated from that policy and the
committed OpenAPI specification. CI fails when either the OpenAPI parity report
or runtime catalog is stale.

## Trace-driven evaluation

`elaine_turn_traces` remains a sanitized flight recorder. The owner diagnostics
endpoint now evaluates the structural portions of the last 30 days of finished
turns and reports:

- healthy, needs-review, and failed turn counts;
- average quality, required-step completion, observation success, and tool
  efficiency rates plus average elapsed time;
- turns that replanned, approached a runtime budget, or attempted a
  consequential step more than once.

The evaluator consumes plan status, sanitized observation status, verification
status, bounded events, and timestamps. It never consumes or returns prompts,
message bodies, memories, raw tool payloads, provider response identifiers,
credentials, provider error bodies, or hidden reasoning. Historical persisted
traces do not contain exact model-round usage, so diagnostics conservatively
derive tool calls from observations, replans from `plan_revised` events, and
elapsed time from stored timestamps.

Trace metrics do not automatically rewrite prompts or teach Elaine from
production data. When a recurring pattern appears:

1. reproduce the behavior with invented names, identifiers, dates, and results;
2. add a non-sensitive scenario or trace fixture with the expected tools,
   confirmation state, terminal state, and forbidden behavior;
3. implement the smallest runtime/tool correction;
4. require the deterministic candidate gate and normal CI to pass.

This makes actual use reveal where Elaine needs improvement without allowing
private household content or one anomalous turn to alter her behavior.

## Ornament barcode scanner

The ornament scan page and detail-page dialog share
`useBarcodeCamera`. It prefers the browser's native `BarcodeDetector`, falls
back to ZXing, and keeps the existing AI photo/manual-entry alternatives.
View-mode scans save the UPC to the current ornament. Edit-mode scans change
only the UPC draft so other unsaved fields remain intact until the normal Save
action.

## Rollback

No database schema change is required. A rollback redeploys the previous
application commit. The existing trace, conversation, memory, and OpenAI
response-state tables remain unchanged.

## Replit review and deployment

1. Read issue #351, this document, and the PR description.
2. In Replit Plan mode, build a review/merge/pull plan before taking action.
3. Review the GitHub diff; do not reimplement it in Replit.
4. Confirm GitHub CI, Guardrails, CodeQL, capability parity, operation-catalog
   drift, typecheck, builds, and tests are green.
5. Smoke-test ornament scanning from both view and edit modes. In edit mode,
   change another field before scanning and confirm it remains in the draft.
6. Ask Elaine to discover/read an operation without a dedicated tool, such as
   an owner job-health read.
7. Ask Elaine to perform a non-destructive generic mutation and confirm that
   the normal confirmation card appears before execution.
8. Confirm a restricted channel cannot invoke the generic operation tools.
9. As owner, inspect `/api/elaine/diagnostics` and confirm `traceQuality`
   contains only counts/rates.
10. Merge the PR into GitHub `main`, pull the merged `main` into the Repl,
    restart/build, and run the normal Replit pre-publishing checklist.
11. If the checklist makes a necessary follow-up commit, document exactly what
    changed and push that commit to GitHub `main` so both copies remain aligned.
