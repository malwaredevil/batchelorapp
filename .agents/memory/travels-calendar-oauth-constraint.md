---
name: Travels Google Calendar OAuth cannot be assistant-triggered
description: elAIne (travels assistant) can help with calendar status/selection/disconnect but never the initial OAuth connect step.
---

The Google Calendar "connect" flow uses a full browser redirect
(`window.location.href = "/api/travels/google-calendar/connect"`), not a
client-side route. It cannot be triggered by any assistant action or fetch —
only a real user click on the Connect button starts it.

**Why:** OAuth authorization requires an actual top-level navigation to
Google's consent screen with browser-set cookies/state; a JSON action executor
or client-side router push cannot perform that redirect.

**How to apply:** Any assistant/automation feature that touches Google
Calendar connection should only ever: (1) report current status, (2) select
which already-authorized calendar to sync to, (3) disconnect an existing
connection. For "connect", offer to navigate the user to the Settings page and
have them click Connect themselves — never claim to have connected it.
