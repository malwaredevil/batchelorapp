---
name: AgentPhone webhook registration
description: How to actually register an AgentPhone webhook and get its signing secret, plus the 10DLC gotcha that blocks outbound SMS afterward.
---

Registering a webhook is a real API call, not a dashboard-only step: `POST https://api.agentphone.ai/v1/webhooks` (not `https://agentphone.ai`, which is just the marketing site and returns HTML) with `Authorization: Bearer $AGENTPHONE_API_KEY` and body `{"url": "<public-webhook-url>"}`. The response body contains the HMAC signing secret (`secret` field, format `whsec_...`) needed for verifying inbound webhook signatures — there is no separate dashboard screen to copy it from; it only exists in this API response. `GET /v1/webhooks` returns the currently registered webhook (or `null`), useful to confirm registration without creating a duplicate.

**Why:** the account owner's example curl used a placeholder root-domain URL; the real API lives on the `api.` subdomain and needed endpoint discovery via probing (`/v1/agents` also works and lists configured agents).

**How to apply:** when wiring an AgentPhone webhook, register it once via this API call using the repl's public domain (`https://$REPLIT_DEV_DOMAIN/api/...` in dev), capture the returned secret, and have the user paste it into a requested secret via `requestEnvVar` (there's no way for the agent to set secret values directly).

**Gotcha — 10DLC gates outbound SMS entirely:** even after the webhook is correctly registered and verified end-to-end (signature check, replay dedup, inbound routing all functional), outbound `sendSms` calls will fail with a 403 `"Outbound SMS is not enabled for this account. Complete 10DLC registration first."` until the AgentPhone account completes carrier 10DLC registration — this is an external, account-level approval process on AgentPhone's side, not a bug in the integration code. Inbound webhook processing (STOP/HELP/START, Elaine turns) still works and should be verified independently of outbound send success.
