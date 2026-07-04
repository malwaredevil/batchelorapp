---
name: Travels reminder-to-calendar sync target
description: Reminder Google Calendar sync must target the single shared Travel calendar owner, not each recipient's personal calendar or a request-scoped "current user".
---

Reminder events are synced to Google as one row per reminder in
`travels_reminder_calendar_events`, written using the **Travel calendar
owner's** access token/calendar id (looked up via `getTravelCalendarConnection()`),
not the reminder creator's or any recipient's personal calendar.

**Why:** an earlier design fanned reminders out to every recipient's own
"oldest connected calendar" — that meant N duplicate events per reminder, no
single source of truth, and reminders that couldn't be seen on the shared
"Travel" overlay. Code review flagged this as inconsistent with the
single-shared-calendar model used everywhere else in the multi-calendar
rework.

**How to apply:** when writing sync/reconciliation logic against a "shared"
resource (single owner-assigned calendar, single shared inbox, etc.), resolve
the _shared_ target explicitly (e.g. `getReminderSyncTarget()`) rather than
deriving it per-caller from `req.session.userId` or per-recipient lookups.
Also don't confuse "is the owner of the currently-assigned resource" with
"is the app owner" — an `app_users.is_owner` flag should gate reassignment
rights, independent of who currently holds the resource.
