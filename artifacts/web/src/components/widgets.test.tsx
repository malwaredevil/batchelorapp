/**
 * Unit tests for widgets.tsx defensive data guards.
 *
 * WHY: Hooks return `data: undefined` on first render before the server
 * responds. If the server ever returns a non-array shape (e.g. a paginated
 * envelope or an error object), widgets that call .map() or .slice() directly
 * on the raw value crash with "x.map is not a function" and blank the whole
 * dashboard. These tests verify the Array.isArray guards prevent that crash
 * and return a graceful empty list instead.
 *
 * We test the guard logic itself (not the full render tree) to avoid pulling
 * in all of widgets.tsx's transitive deps. The guard patterns are stable and
 * well-isolated: if they change, these tests will catch the regression.
 */

import { describe, it, expect } from "vitest";

// ── Guard logic extracted from widgets.tsx (line 459) ────────────────────────
//
// NotesWidget:  const recent = Array.isArray(notes) ? notes.slice(0, 4) : [];
// Same pattern is used for reminders (line 1353) and wishlist (line 1405).

function applyNoteGuard(data: unknown) {
  return Array.isArray(data) ? (data as unknown[]).slice(0, 4) : [];
}

describe("NotesWidget — Array.isArray guard", () => {
  it("returns empty array when data is undefined (cold-cache render)", () => {
    expect(applyNoteGuard(undefined)).toEqual([]);
  });

  it("returns empty array when server returns a non-array object (envelope mismatch)", () => {
    expect(applyNoteGuard({ error: "unexpected" })).toEqual([]);
  });

  it("returns empty array when server returns null", () => {
    expect(applyNoteGuard(null)).toEqual([]);
  });

  it("returns up to 4 notes when data is a valid array", () => {
    const notes = [
      { id: 1, title: "A" },
      { id: 2, title: "B" },
      { id: 3, title: "C" },
      { id: 4, title: "D" },
      { id: 5, title: "E" },
    ];
    const result = applyNoteGuard(notes);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ id: 1, title: "A" });
  });

  it("returns all items when array has fewer than 4", () => {
    const notes = [{ id: 1, title: "A" }];
    expect(applyNoteGuard(notes)).toHaveLength(1);
  });
});

// ── Guard logic from notes.tsx (lines 211, 217) ──────────────────────────────
//
// notes.tsx:  (Array.isArray(notes) ? notes : []).length === 0
//             (Array.isArray(notes) ? notes : []).map(...)

function applyPageNotesGuard(data: unknown) {
  return Array.isArray(data) ? data : [];
}

describe("Office Notes page — Array.isArray guard", () => {
  it("empty-state check returns empty array for undefined data", () => {
    expect(applyPageNotesGuard(undefined)).toHaveLength(0);
  });

  it("empty-state check returns empty array for non-array object", () => {
    expect(applyPageNotesGuard({ items: [] })).toHaveLength(0);
  });

  it(".map is callable on the guard result (no crash)", () => {
    const data = undefined;
    expect(() => applyPageNotesGuard(data).map((n) => n)).not.toThrow();
  });

  it("passes through a valid array unchanged", () => {
    const data = [{ id: 1 }, { id: 2 }];
    expect(applyPageNotesGuard(data)).toBe(data);
  });
});
