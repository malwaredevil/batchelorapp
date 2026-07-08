---
name: Elaine chat attachment filename persistence
description: Why PDF chips in Elaine chat history must not derive filenames from the storage URL
---

Elaine chat attachments (`elaine_history_messages.attachment_urls`, jsonb) are stored as an array of `{ url, type: "image"|"pdf", name? }` objects, not plain URL strings. `name` is only meaningful for PDFs.

**Why:** the upload endpoint writes files to Supabase Storage under a randomly generated path (`${userId}/${randomUUID()}.pdf`), so the URL never contains the user's original filename. Deriving a display filename via regex on the URL (as an earlier version did) shows the ugly storage UUID instead of e.g. "invoice.pdf". The original filename is only available at upload time (`req.file.originalname`) and must be threaded through explicitly (upload response → chat request body → persisted message → conversation history GET) rather than reconstructed later.

**How to apply:** any code reading `attachmentUrls` must handle both formats — older rows may still be plain strings (back-compat). Normalize with a small helper that treats a string entry as `{ url, type: sniffed-from-extension }` with no `name`, and only trust `name` when present on an object entry. Never re-derive a "nicer" filename from the URL path.
