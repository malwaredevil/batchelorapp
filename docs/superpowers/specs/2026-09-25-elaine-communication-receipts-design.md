# Elaine outbound communication receipts

Date: 2026-09-25
Status: approved for implementation after user review

## Problem and observed incident

Elaine can propose or promise a call/message without a verified execution result. The web approval endpoint returns a provider result, but the shared chat hook clears the pending actions and displays a transient "Done!" toast without attaching that result to the conversation. Auto-run results are also kept only in the current turn. Follow-up questions can therefore elicit an invented "I never called" answer even when a provider accepted a call.

The 2026-09-25 incident produced three separate outbound call IDs and three call-ended webhooks after repeated requests. The synchronous call responses were `pending`; the logs alone do not establish whether the recipient answered or what was spoken. No confirmed SMS delivery result was found. Do **not** re-send or replay any incident action as part of the fix or its tests.

## Scope

Cover Elaine-initiated outbound calls and messages to household contacts through voice, SMS, email, Slack, and Elaine chat, including web confirmation, "Approve all", auto-run, and scheduled delivery. Use one shared receipt mechanism rather than a separate UI-only solution per channel. Existing channel eligibility, SMS consent/opt-out, rate limits, confirmation settings, and provider integrations remain in force.

## Receipt and execution contract

- Each approved or auto-run action has a durable, owner-scoped receipt with a stable attempt ID, action type, channel, recipient user ID, conversation/turn association where available, timestamps, status, and provider reference if one exists. Multi-recipient sends have an individual outcome per recipient. Do not store message text, phone numbers, email addresses, request bodies, or provider credentials in the receipt or new logs. A merely proposed action remains a proposal, not an execution receipt.
- States distinguish **executing**, **provider accepted / outcome pending**, **confirmed completed**, **failed before acceptance**, and **unknown after an ambiguous provider response**. A scheduled action has its own **scheduled** state until its dispatch starts, or **cancelled** if cancelled before dispatch. The UI can also display an unexecuted **awaiting approval** proposal. A call-ended signal is not proof that the recipient answered. A successful SMS API response is provider acceptance, not proof of delivery. A provider callback can advance a receipt only when it can be correlated by a provider reference; absent evidence, leave its status pending/unknown.
- A validated approval request carries a server-issued proposal/attempt key. The server atomically claims that key before making any external call. A duplicate approval reads the prior receipt rather than re-executing the provider request. Auto-run uses a stable per-turn tool-call key and the same claim path. A network failure after dispatch becomes **unknown**, never an automatic retry. Failed validation and no-tool-call turns produce no "sent" receipt.
- A new explicit request to retry a recent contact action first checks recent receipts for the same recipient/channel. If an attempt may already have reached the provider, Elaine explains its status and asks for explicit approval of an **additional** attempt, even in full-auto mode. Do not silently suppress a legitimately new request forever; distinguish a deliberate repeat from an accidental replay.
- Scheduled actions retain their existing reminder-based dispatch. Link a receipt to the schedule and update it when the job fires; creating a schedule is not a sent message. Prevent the same scheduled job from causing multiple provider attempts during retries. Preserve cancellation semantics.

## Read and display

- Add an authenticated, user-scoped read route for recent communication receipts, with bounded pagination and no message body or raw contact details. The chat's action endpoint returns receipt IDs and current states; "Approve all" collects each result, shows per-action outcomes, and keeps failed/unknown states visible rather than replacing everything with "Done!".
- **Immediate action progress:** When a confirmed action starts, replace its approval card with an active status such as "Calling…" or "Sending SMS…" _before_ waiting for the provider. Show one independently updating row per action/recipient in "Approve all." In full-auto mode, emit a progress event as the action is claimed, show it while Elaine's streamed turn continues, and emit the observed result before ending the turn. If the model never calls an action tool, show no false execution status.
- The active status belongs to the action, not to Elaine's thinking/plan indicator: in confirmation modes the original chat response must end so the user can approve it, but its action card remains visible and progresses after approval without requiring another user message or another model turn. Do not leave the UI at "I’ll do it" after the approval completes.
- Keep the action visibly "Working…" during bounded provider waiting; if the call or message is still unresolved at the timeout, show "Initiated; outcome pending" or "Status unknown" as appropriate and continue checking only by safe receipt/provider-reference reads. Never automatically resend because the wait expired. Use the existing provider's bounded call reconciliation first; adjust the UI/action request timeout and send keep-alive/progress events where necessary, based on measured provider latency. Do not raise Elaine's reasoning/token budget merely to keep a status on screen.
- In the shared Elaine chat component, render receipts adjacent to the associated turn and restore them after refresh and conversation switches. Clearly label "call initiated", "call ended (answer unknown)", "provider accepted SMS", "scheduled", "failed", and "status unknown" according to evidence; never label pending as delivered. Keep a short failure explanation where safe.
- Give Elaine a read-only receipt-lookup tool and require it for "did it go through?" questions. The response must cite the actual attempt status rather than infer from its prior prose, plan progress, or a missing confirmation card. If no receipt exists, say there is no recorded execution, not that provider delivery was impossible.
- A turn that promises an external action without emitting an executable tool call must be marked as unperformed in the final server result; the UI and Elaine must not present it as complete. Preserve the distinction between proposed, confirmed, and executed actions.

## Safety and migration

- Add the receipt table through the project's additive schema mechanism, with owner/recipient scoping, a unique attempt key, bounded indexes, and an explicit retention policy. Do not backfill historical "success" from chat text. The three incident calls may only be shown as historical attempts if they can be correlated safely to existing provider records.
- Roll out server and shared UI together. An old client request without a server-issued proposal key must receive a clear re-open/retry error **before** any provider dispatch; do not silently execute it through an unprotected legacy path.
- Log attempt IDs, status transitions, and error categories only; never log message contents or phone numbers. Keep external provider failures non-sensitive in the UI. Follow existing shared-library and API contract/codegen conventions.

## Verification

- Unit and API tests: proposal-to-approval, repeated/parallel approval, "Approve all" partial success, auto-run, network ambiguity after dispatch, explicit retry, scheduled worker replay, channel-specific provider acceptance versus actual delivery, and owner isolation.
- UI tests: immediate approval and auto-run visibly progress from "Calling…"/"Sending…" to the observed result, including a provider wait that outlasts the chat reply; each outcome card survives reload and conversation switching; status lookups inform Elaine's follow-up answer; unknown states never become "Done!".
- Run provider fakes for calls/SMS/email/Slack; do not place any real outbound communication in development or verification. Verify typecheck, focused tests, full relevant validations, API health, and a read-only browser flow. Do not publish until the existing PR/CI and safety gates pass.
