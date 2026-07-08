---
name: Two distinct Gmail pages at the same path in different apps
description: Hub ("web" artifact) and Travels both have a route literally named "/gmail" but they are unrelated features — don't conflate them.
---

`artifacts/web/src/pages/gmail/GmailPage.tsx` (Hub app, mounted at `/gmail`) is a full webmail client — browse/search/read/compose/label/archive/trash the household's connected Gmail inbox.

Travels' own `/gmail` page is a completely different feature: reviewing AI-detected travel confirmation emails and linking them as trip documents (scan suggestions + manual browse-to-link), not a general inbox client.

Both reuse the same underlying Gmail OAuth connection/tokens (per-user, single-owner per threat_model.md), but are separate UI surfaces in separate SPAs. When updating Elaine's APP MAP, action tools, or nav-path allowlists, always double check whether "/gmail" refers to the Hub inbox client or the Travels scan/link feature — they are NOT interchangeable and must be documented/scoped separately (`NAVIGATE_PATH_RE_BY_APP.hub` vs `.travels`).
