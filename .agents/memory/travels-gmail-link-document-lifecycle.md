---
name: Travels Gmail link ↔ trip document lifecycle coupling
description: Deleting a Gmail-linked trip document must also clear its scan-decision row, or the email becomes permanently un-re-addable.
---

# Gmail-linked document deletion must clear the scan-decision row

Linking a Gmail email creates trip document(s) + itinerary entries AND writes a
`travels_gmail_scan_decisions` row with `status='linked'` and `tripDocumentId`
pointing at the created document. The inbox browser derives `alreadyLinked` from
that row's `status`.

**The coupling:** deleting the trip document does NOT automatically remove the
decision row. If you only purge the document + itinerary, the `linked` row is
orphaned, the email stays `alreadyLinked`, and it can never be re-added —
`reconsider` refuses `linked` rows (it only reverses ignored/dismissed).

**Rule:** any code path that deletes a trip document must also delete the
matching `travels_gmail_scan_decisions` row, scoped by `userId = doc.userId`
(the linker, who is the single Gmail-decision owner per the threat model) AND
`tripDocumentId = docId` — never by session user or household. Do it best-effort
(try/catch, logged) so it never blocks the document delete.

**Why:** Gmail decisions are strictly single-owner even though trips are
household-shared; the document's `userId` is the correct owner scope, not
`req.session.userId`.

**Known edge (pre-existing, not fixed here):** for multi-attachment emails the
decision row stores only the LAST created doc's id in `tripDocumentId`. Deleting
a non-last attachment won't clear linkage; deleting the last one clears it even
if sibling docs remain. Linkage is a single pointer, not a message↔many-doc
association.

**How to apply:** when adding new document-deletion paths (bulk delete, trip
delete cascade, rescan-replace), replicate this decision-row cleanup or the same
orphan bug reappears. To recover an already-orphaned row in prod, delete the
specific `travels_gmail_scan_decisions` row via the Supabase REST API (see
supabase-adhoc-access.md).
