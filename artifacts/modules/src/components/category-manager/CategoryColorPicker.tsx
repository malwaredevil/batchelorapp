import { CATEGORY_BG_PALETTE, autoTextColor } from "@workspace/web-core";
import { cn } from "@/lib/utils";

interface CategoryColorPickerProps {
  bgColor: string | null | undefined;
  textColor: string | null | undefined;
  onChange: (bg: string, text: string) => void;
  disabled?: boolean;
}

export function CategoryColorPicker({
  bgColor,
  textColor,
  onChange,
  disabled,
}: CategoryColorPickerProps) {
  const currentBg = bgColor ?? "";
  return (
    <div className="p-3 space-y-3 w-56">
      <p className="text-xs font-medium text-muted-foreground">
        Background colour
      </p>
      <div className="flex flex-wrap gap-1.5">
        {CATEGORY_BG_PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            disabled={disabled}
            title={color}
            onClick={() => onChange(color, autoTextColor(color))}
            className="h-6 w-6 rounded-full transition hover:scale-110 ring-offset-1"
            style={{
              backgroundColor: color,
              outline:
                currentBg === color
                  ? `2px solid ${color}`
                  : "2px solid transparent",
              outlineOffset: "2px",
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Custom:</span>
        <input
          type="color"
          value={currentBg || "#2980b9"}
          disabled={disabled}
          onChange={(e) =>
            onChange(e.target.value, autoTextColor(e.target.value))
          }
          className="h-6 w-10 cursor-pointer rounded border border-card-border p-0.5 bg-transparent"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Text colour:</span>
        <div className="flex gap-1">
          {(["#000000", "#ffffff"] as const).map((tc) => (
            <button
              key={tc}
              type="button"
              disabled={disabled}
              onClick={() => onChange(currentBg || "#2980b9", tc)}
              className={cn(
                "h-6 w-6 rounded border-2 text-[10px] font-bold transition",
                textColor === tc
                  ? "border-foreground scale-110"
                  : "border-transparent opacity-60 hover:opacity-90",
              )}
              style={{
                backgroundColor: tc === "#000000" ? "#fff" : "#000",
                color: tc,
              }}
            >
              A
            </button>
          ))}
        </div>
      </div>
      {currentBg && (
        <div className="pt-1">
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: currentBg,
              color: textColor ?? autoTextColor(currentBg),
            }}
          >
            Preview
          </span>
        </div>
      )}
    </div>
  );
}
