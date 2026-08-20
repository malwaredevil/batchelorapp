import { useState } from "react";
import { Loader2 } from "lucide-react";
import { QuickEditSheetFrame } from "./quick-edit-sheet";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CollectionEditFieldType =
  | "string"
  | "number"
  | "decimal"
  | "boolean"
  | "date"
  | "string[]";

export interface CollectionEditField {
  key: string;
  label: string;
  type: CollectionEditFieldType;
}

export interface CollectionEditCategory {
  id: number;
  name: string;
}

export type CollectionEditFieldValue =
  | string
  | number
  | boolean
  | string[]
  | null;

export interface CollectionItemEditSheetSavePayload {
  name: string;
  notes: string | null;
  /** Custom field values keyed by field key. */
  fields: Record<string, CollectionEditFieldValue>;
  /** Present only when the sheet was given a `categories` prop. */
  categoryIds?: number[];
}

export interface CollectionItemEditSheetProps {
  title: string;
  thumbnailUrl?: string | null;
  initialName: string;
  initialNotes: string | null;
  /** Custom fields beyond name and notes, in display order. */
  fields?: CollectionEditField[];
  /** Initial values for each custom field key. */
  initialFieldValues?: Record<string, CollectionEditFieldValue>;
  /** When provided, renders a category chip picker below the custom fields. */
  categories?: CollectionEditCategory[];
  initialCategoryIds?: number[];
  onSave: (payload: CollectionItemEditSheetSavePayload) => Promise<void> | void;
  onClose: () => void;
  /** Lets the caller signal an in-flight mutation (disables the Save button). */
  isSaving?: boolean;
}

// ---------------------------------------------------------------------------
// Shared input class (keeps Tailwind in the source scan for this lib)
// ---------------------------------------------------------------------------

const INPUT_CLASS =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm " +
  "ring-offset-background placeholder:text-muted-foreground " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Generic edit sheet for any scaffolded collection module.
 *
 * Renders inside a `QuickEditSheetFrame` and manages local form state for
 * name, notes, typed custom fields, and an optional category chip picker.
 * The caller supplies the mutation via `onSave`.
 */
export function CollectionItemEditSheet({
  title,
  thumbnailUrl,
  initialName,
  initialNotes,
  fields = [],
  initialFieldValues = {},
  categories,
  initialCategoryIds = [],
  onSave,
  onClose,
  isSaving = false,
}: CollectionItemEditSheetProps) {
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [fieldValues, setFieldValues] = useState<
    Record<string, CollectionEditFieldValue>
  >(() => {
    const init: Record<string, CollectionEditFieldValue> = {};
    for (const f of fields) {
      init[f.key] = initialFieldValues[f.key] ?? null;
    }
    return init;
  });
  const [categoryIds, setCategoryIds] = useState<number[]>(initialCategoryIds);
  const [localSaving, setLocalSaving] = useState(false);

  function setFieldValue(key: string, value: CollectionEditFieldValue) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!name.trim()) return;
    setLocalSaving(true);
    try {
      await onSave({
        name: name.trim(),
        notes: notes.trim() || null,
        fields: fieldValues,
        categoryIds: categories !== undefined ? categoryIds : undefined,
      });
    } finally {
      setLocalSaving(false);
    }
  }

  const isWorking = localSaving || isSaving;

  return (
    <QuickEditSheetFrame
      title={`Edit ${title}`}
      onClose={onClose}
      thumbnail={thumbnailUrl ? { src: thumbnailUrl } : null}
      footer={
        <>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isWorking || !name.trim()}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {isWorking && <Loader2 className="h-4 w-4 animate-spin" />}
            {isWorking ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isWorking}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
          >
            Cancel
          </button>
        </>
      }
    >
      {/* Name ---------------------------------------------------------------- */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Name <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className={INPUT_CLASS}
        />
      </div>

      {/* Notes --------------------------------------------------------------- */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Notes
        </label>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes…"
          className={INPUT_CLASS}
        />
      </div>

      {/* Custom fields ------------------------------------------------------- */}
      {fields.map((f) => (
        <div key={f.key} className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            {f.label}
          </label>

          {f.type === "boolean" ? (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`field-${f.key}`}
                checked={(fieldValues[f.key] as boolean | null) ?? false}
                onChange={(e) => setFieldValue(f.key, e.target.checked)}
                className="h-4 w-4 rounded border"
              />
              <label
                htmlFor={`field-${f.key}`}
                className="text-sm text-muted-foreground"
              >
                {f.label}
              </label>
            </div>
          ) : f.type === "string[]" ? (
            <input
              type="text"
              value={
                Array.isArray(fieldValues[f.key])
                  ? (fieldValues[f.key] as string[]).join(", ")
                  : ""
              }
              onChange={(e) =>
                setFieldValue(
                  f.key,
                  e.target.value
                    ? e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    : [],
                )
              }
              placeholder="Comma-separated values"
              className={INPUT_CLASS}
            />
          ) : f.type === "number" ? (
            <input
              type="number"
              step="1"
              value={
                fieldValues[f.key] != null ? String(fieldValues[f.key]) : ""
              }
              onChange={(e) =>
                setFieldValue(
                  f.key,
                  e.target.value === "" ? null : parseInt(e.target.value, 10),
                )
              }
              className={INPUT_CLASS}
            />
          ) : f.type === "decimal" ? (
            <input
              type="number"
              step="0.01"
              value={
                fieldValues[f.key] != null ? String(fieldValues[f.key]) : ""
              }
              onChange={(e) =>
                setFieldValue(
                  f.key,
                  e.target.value === "" ? null : parseFloat(e.target.value),
                )
              }
              className={INPUT_CLASS}
            />
          ) : f.type === "date" ? (
            <input
              type="date"
              value={
                typeof fieldValues[f.key] === "string"
                  ? (fieldValues[f.key] as string)
                  : ""
              }
              onChange={(e) => setFieldValue(f.key, e.target.value || null)}
              className={INPUT_CLASS}
            />
          ) : (
            /* string (default) */
            <input
              type="text"
              value={
                typeof fieldValues[f.key] === "string"
                  ? (fieldValues[f.key] as string)
                  : ""
              }
              onChange={(e) => setFieldValue(f.key, e.target.value || null)}
              placeholder={f.label}
              className={INPUT_CLASS}
            />
          )}
        </div>
      ))}

      {/* Category chip picker ------------------------------------------------ */}
      {categories !== undefined && categories.length > 0 && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Categories
          </label>
          <div className="flex flex-wrap gap-2 pt-1">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() =>
                  setCategoryIds((prev) =>
                    prev.includes(cat.id)
                      ? prev.filter((x) => x !== cat.id)
                      : [...prev, cat.id],
                  )
                }
                className={`rounded-full px-3 py-1 text-sm transition-colors ${
                  categoryIds.includes(cat.id)
                    ? "bg-primary text-primary-foreground"
                    : "border bg-muted hover:bg-muted/80"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </QuickEditSheetFrame>
  );
}
