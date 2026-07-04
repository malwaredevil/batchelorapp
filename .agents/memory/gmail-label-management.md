---
name: Gmail label management (Travel/Batchelor App labels)
description: When Gmail labels get applied vs. not, and why the write scope stays narrow — relevant to any future Gmail read/write feature.
---

Label writes (`gmail.labels` scope) are triggered ONLY by the user confirming an AI-generated scan suggestion is travel-related — never by AI classification alone, and never by the manual inbox browse/search flow (link or ignore there only writes to the decision ledger, no Gmail API label call). This was an explicit user decision, not a default worth assuming next time: manual picks reflect the user already finding the email themselves, so there's no "AI called it travel" moment to confirm.

**Why:** keeps the new write scope's blast radius auditable — a compromised session can only ever cause label writes on messages the user already reviewed via a suggestion, not on arbitrary messages a script could walk through inbox search.

**How to apply:** any Gmail action with real-world side effects (labels, future actions like archiving) should ask "does this confirm something the AI proposed, or is the user acting unprompted on their own?" — only the former should carry write-scope side effects. Also: label API scopes are additive to `gmail.readonly`, not alternatives — `gmail.metadata` is a _restrictive_ replacement for `readonly`, not an addable scope, so don't reach for it when you need write on top of read. All label API calls are wrapped best-effort (log + swallow) so Gmail API failures never block the underlying link/ingest request — apply the same pattern to any future non-critical Gmail write.
