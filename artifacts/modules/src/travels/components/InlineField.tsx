import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, Pencil, Calendar, Upload, Hash, Copy } from "lucide-react";
import { toast } from "sonner";

export type InlineFieldIconType =
  | "text"
  | "date"
  | "number"
  | "upload"
  | "custom";

const ICONS: Record<
  InlineFieldIconType,
  React.ComponentType<{ className?: string }>
> = {
  text: Pencil,
  date: Calendar,
  number: Hash,
  upload: Upload,
  custom: Pencil,
};

interface InlineFieldBaseProps<T> {
  label: string;
  icon?: React.ReactNode;
  iconType?: InlineFieldIconType;
  value: T;
  onSave: (value: T) => void | Promise<void>;
  saving?: boolean;
  isEmpty?: (value: T) => boolean;
  emptyText?: string;
  className?: string;
  layout?: "row" | "stack";
  /**
   * Enables the copy-to-clipboard button. Defaults to `true` whenever the
   * field's value is a non-empty string; pass `false` to opt out, or a
   * function to derive the copyable text from a non-string value type.
   */
  copyable?: boolean | ((value: T) => string | null | undefined);
}

interface InlineFieldCustomProps<T> extends InlineFieldBaseProps<T> {
  renderDisplay: (value: T) => React.ReactNode;
  renderEditor: (
    draft: T,
    setDraft: (v: T) => void,
    commit: () => void,
    cancel: () => void,
  ) => React.ReactNode;
}

/**
 * Generic per-field inline editor. Shows a label, the current value, and a
 * contextual icon button (pencil/calendar/upload/etc.) that toggles the field
 * into an editable state in place. Save/cancel commit or discard the draft.
 */
export function InlineField<T>({
  label,
  icon,
  iconType = "custom",
  value,
  onSave,
  saving,
  isEmpty,
  emptyText = "Not set",
  className,
  layout = "stack",
  copyable,
  renderDisplay,
  renderEditor,
}: InlineFieldCustomProps<T>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(value);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    onSave(draft);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const IconComp = ICONS[iconType];
  const iconNode = icon ?? <IconComp className="w-3.5 h-3.5" />;

  const empty = isEmpty ? isEmpty(value) : value == null || value === "";

  const copyText =
    typeof copyable === "function"
      ? copyable(value)
      : copyable === false
        ? undefined
        : typeof value === "string"
          ? value
          : undefined;
  const showCopy = !empty && !!copyText;

  const handleCopy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  if (editing) {
    return (
      <div className={className}>
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <div
          className={
            layout === "row" ? "flex items-start gap-2" : "space-y-1.5"
          }
        >
          <div className="flex-1 min-w-0">
            {renderEditor(draft, setDraft, commit, cancel)}
          </div>
          <div className="flex gap-1 shrink-0">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-primary hover:text-primary"
              onClick={commit}
              disabled={saving}
              title="Save"
            >
              <Check className="w-3.5 h-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={cancel}
              title="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`group flex items-start gap-2 ${className ?? ""}`}>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        {empty ? (
          <p className="text-sm text-muted-foreground/70 italic">{emptyText}</p>
        ) : (
          renderDisplay(value)
        )}
      </div>
      {/*
        Buttons stay subtly visible by default (touch devices have no hover
        state to reveal them), but on hover-capable pointers they're hidden
        until the row is hovered or a button inside receives keyboard focus.
      */}
      <div
        className="shrink-0 flex items-center gap-0.5 mt-0.5 opacity-60 transition-opacity
          [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100
          focus-within:opacity-100"
      >
        {showCopy && (
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 text-muted-foreground/60 hover:text-foreground rounded"
            title={copied ? "Copied!" : `Copy ${label.toLowerCase()}`}
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-primary" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="p-1 text-muted-foreground/60 hover:text-foreground rounded"
          title={`Edit ${label.toLowerCase()}`}
        >
          {iconNode}
        </button>
      </div>
    </div>
  );
}

// ─── Preset editors for the common scalar field types ─────────────────────────

interface PresetProps extends InlineFieldBaseProps<string> {
  placeholder?: string;
  displayValue?: (value: string) => React.ReactNode;
}

export function InlineTextField({
  displayValue,
  placeholder,
  ...props
}: PresetProps) {
  return (
    <InlineField
      {...props}
      iconType={props.iconType ?? "text"}
      renderDisplay={(v) => (
        <p className="text-sm text-foreground break-words">
          {displayValue ? displayValue(v) : v}
        </p>
      )}
      renderEditor={(draft, setDraft, commit, cancel) => (
        <Input
          autoFocus
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
        />
      )}
    />
  );
}

export function InlineTextareaField({
  displayValue,
  placeholder,
  ...props
}: PresetProps & { rows?: number }) {
  return (
    <InlineField
      {...props}
      iconType={props.iconType ?? "text"}
      renderDisplay={(v) => (
        <p className="text-sm text-foreground whitespace-pre-wrap break-words">
          {displayValue ? displayValue(v) : v}
        </p>
      )}
      renderEditor={(draft, setDraft, commit, cancel) => (
        <Textarea
          autoFocus
          rows={props.rows ?? 3}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
          }}
        />
      )}
    />
  );
}

export function InlineDateField(
  props: InlineFieldBaseProps<string> & {
    displayValue?: (value: string) => React.ReactNode;
  },
) {
  const { displayValue, ...rest } = props;
  return (
    <InlineField
      {...rest}
      iconType="date"
      renderDisplay={(v) => (
        <p className="text-sm text-foreground">
          {displayValue ? displayValue(v) : v}
        </p>
      )}
      renderEditor={(draft, setDraft, commit, cancel) => (
        <DateAutoOpenInput
          value={draft}
          onChange={setDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
        />
      )}
    />
  );
}

function DateAutoOpenInput({
  value,
  onChange,
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    try {
      (
        ref.current as HTMLInputElement & { showPicker?: () => void }
      )?.showPicker?.();
    } catch {
      // showPicker isn't supported everywhere; focusing is enough of a fallback.
    }
  }, []);
  return (
    <Input
      ref={ref}
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

export function InlineNumberField(
  props: InlineFieldBaseProps<number> & { min?: number; max?: number },
) {
  return (
    <InlineField
      {...props}
      iconType="number"
      renderDisplay={(v) => <p className="text-sm text-foreground">{v}</p>}
      renderEditor={(draft, setDraft, commit, cancel) => (
        <Input
          autoFocus
          type="number"
          min={props.min}
          max={props.max}
          value={draft}
          onChange={(e) => setDraft(Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
        />
      )}
    />
  );
}
