---
name: React Fragment children inside a flex+gap container get spaced apart
description: A component returning a bare Fragment (<>...</>) renders as broken/huge gaps when placed inside a flex container that uses `gap-*`
---

A component that returns a bare Fragment (`<>text<span>styled</span>text</>`) looks fine
in isolated/prose contexts (paragraphs, headings), but breaks visually when a caller
places it inside a `flex ... gap-*` container (e.g. a shadcn `DropdownMenuItem`,
`flex items-center gap-2`). Each Fragment child (text run or element) becomes its own
anonymous flex item, and the container's `gap` is applied *between* them — turning
"Turn off Elaine" into "Turn off  El  AI  ne" with huge spacing.

**Why:** Fragments don't create a DOM wrapper, so flex layout treats each of their
children as independent flex items rather than as one inline unit.

**How to apply:** Any small reusable text/label component that mixes plain text with a
styled inline `<span>` should return a single wrapping `<span>` (not a Fragment) if it
might ever be composed inside a flex/grid container with `gap`. When debugging
mysteriously large gaps around one specific child in a flex row, check whether that
child is a component returning a Fragment.
