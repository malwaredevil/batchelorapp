# Hub widget audit

This is the current judgment call for the Hub widget library. Catalog entries
are intentionally limited to widgets that either read household data or make
their offline curated source explicit.

## Keep or improve

- **Pottery Stats, Quilting Stats, Fabric Stash, Block Designer, Quilt Layouts** —
  live collection stats with direct links.
- **Shopping List** — live quilting shopping items with an empty state and link
  to the full list.
- **Random Piece** — live pottery item surprise with a direct item link.
- **Travel Stats, Next Trip, Trip Reminders, Travel Wishlist** — live Travels
  data, with useful empty states and navigation.
- **Magnets Stats** — live magnet total/category summary, with collection and
  add links.
- **Notes** — live Office notes plus inline creation; an empty state directs the
  household to create one.
- **Quick Add, AI Search, RSS Feed** — actionable tools. RSS is user-configured
  and reports loading, empty, and fetch errors.
- **Local Weather** — live weather widget.
- **Glaze Tip, Pattern Idea, Daily Inspiration** — kept as intentionally
  offline curated libraries; descriptions no longer imply a live feed.

## Retire

- **Recent Activity** and **Goals** — showed fabricated, static household
  activity/progress.
- **Maintenance Log** — showed fabricated tasks instead of a maintenance API.
- **Countdown** — was tied to one hardcoded event date.
- **Maker Links** — claimed to be a pinned/user-managed list but contained
  hardcoded external links.
- **Photo of the Day** — showed a text-only random pottery item, not a photo,
  and duplicated Random Piece.

Retiring a catalog entry does not delete a saved slot. Unknown static IDs are
retained during local/server parsing and displayed as a removable “Retired
widget” card, preserving order and giving the user an explicit cleanup path.

## Add

- **Magnets Stats** was the only new module widget warranted by the current
  data surface: the paginated collection endpoint already exposes a total and
  the category endpoint exposes a useful breakdown. No additional widget is
  added just to represent a module.

## Elaine card metrics

The Hub Elaine card now shows **Open tasks** (queued, running, waiting for the
household, or blocked Elaine research tasks) and **Saved chats**. Both values
come from authenticated aggregate endpoints—not the paginated task/history
lists—so they remain exact for larger households. Both link directly to Elaine,
where the task state or history can be acted on. Loading remains `—`; no-data
responses resolve to `0`, rather than permanent placeholder Nudges/Memory
values.
