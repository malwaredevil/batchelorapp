import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type SyntheticEvent,
} from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@workspace/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/dialog";

import {
  clampFraming,
  getActiveThumbnail,
  getFramingStyle,
  isThumbnailStale,
  panFraming,
  staleThumbnailKey,
  THUMBNAIL_MAX_ZOOM,
  THUMBNAIL_MIN_ZOOM,
  type ThumbnailConfigValue,
  type ThumbnailFramingValue,
} from "./thumbnail-geometry";
export type { ThumbnailConfigValue, ThumbnailFramingValue };

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export interface PotteryThumbnailImageProps {
  src: string;
  alt: string;
  /** Raw item.thumbnail. Unset or stale renders the plain default image. */
  thumbnail?: ThumbnailConfigValue | null;
  /** Classes for the default (unset) <img>, exactly as before. */
  imgClassName?: string;
  imgStyle?: CSSProperties;
  imgRef?: Ref<HTMLImageElement>;
  loading?: "lazy" | "eager";
  onLoad?: (e: SyntheticEvent<HTMLImageElement>) => void;
  onError?: (e: SyntheticEvent<HTMLImageElement>) => void;
  /** Classes on the framing wrapper (custom mode only). */
  frameClassName?: string;
}

export function PotteryThumbnailImage({
  src,
  alt,
  thumbnail,
  imgClassName,
  imgStyle,
  imgRef,
  loading,
  onLoad,
  onError,
  frameClassName,
}: PotteryThumbnailImageProps) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const localRef = useRef<HTMLImageElement | null>(null);
  const active = getActiveThumbnail(src, thumbnail);

  useEffect(() => {
    setDims(null);
    const el = localRef.current;
    if (el?.complete && el.naturalWidth > 0) {
      setDims({ w: el.naturalWidth, h: el.naturalHeight });
    }
  }, [src]);

  const setRefs = (el: HTMLImageElement | null) => {
    localRef.current = el;
    if (typeof imgRef === "function") imgRef(el);
    else if (imgRef)
      (imgRef as { current: HTMLImageElement | null }).current = el;
  };

  const handleLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const t = e.currentTarget;
    if (t.naturalWidth > 0) setDims({ w: t.naturalWidth, h: t.naturalHeight });
    onLoad?.(e);
  };

  if (!active) {
    return (
      <img
        ref={setRefs}
        src={src}
        alt={alt}
        loading={loading}
        onLoad={handleLoad}
        onError={onError}
        style={imgStyle}
        className={imgClassName}
      />
    );
  }

  const geometry: CSSProperties = dims
    ? getFramingStyle(dims.w, dims.h, active)
    : { position: "absolute", opacity: 0, width: "100%", height: "100%" };

  return (
    <div
      className={frameClassName}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <img
        ref={setRefs}
        src={src}
        alt={alt}
        loading={loading}
        onLoad={handleLoad}
        onError={onError}
        draggable={false}
        style={{ ...imgStyle, ...geometry }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor dialog
// ---------------------------------------------------------------------------

export interface PotteryThumbnailEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
  /** Latest item.thumbnail. Stale configs open as the default framing. */
  thumbnail?: ThumbnailConfigValue | null;
  /** Resolve on success; reject to keep the editor open. null = use default. */
  onSave: (framing: ThumbnailFramingValue | null) => Promise<void>;
}

const NUDGE = 0.02;
const DEFAULT_FRAMING: ThumbnailFramingValue = {
  mode: "crop",
  x: 0.5,
  y: 0.5,
  zoom: 1,
};

function EditorBody({
  src,
  alt,
  thumbnail,
  onSave,
  onClose,
  onSavingChange,
}: Omit<PotteryThumbnailEditorProps, "open" | "onOpenChange"> & {
  onClose: () => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const [framing, setFraming] = useState<ThumbnailFramingValue>(() => {
    const a = getActiveThumbnail(src, thumbnail);
    return a
      ? clampFraming({ mode: a.mode, x: a.x, y: a.y, zoom: a.zoom })
      : DEFAULT_FRAMING;
  });
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; size: number } | null>(null);

  const setZoom = (z: number) =>
    setFraming((f) => clampFraming({ ...f, zoom: z }));

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (saving || framing.mode === "contain" || !dims) return;
    const size = frameRef.current?.getBoundingClientRect().width ?? 0;
    if (!size) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, size };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !dims || saving) return;
    const dx = (e.clientX - d.px) / d.size;
    const dy = (e.clientY - d.py) / d.size;
    d.px = e.clientX;
    d.py = e.clientY;
    setFraming((f) => panFraming(dims.w, dims.h, f, dx, dy));
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!dims || saving) return;
    const step = e.shiftKey ? NUDGE * 5 : NUDGE;
    // Arrow moves the photo in that direction (focal point moves inversely).
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const v = map[e.key];
    if (v) {
      e.preventDefault();
      setFraming((f) => panFraming(dims.w, dims.h, f, v[0], v[1]));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      setZoom(framing.zoom * 1.1);
    } else if (e.key === "-") {
      e.preventDefault();
      setZoom(framing.zoom / 1.1);
    }
  };

  async function run(value: ThumbnailFramingValue | null) {
    setSaving(true);
    onSavingChange(true);
    setError(null);
    try {
      await onSave(value);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Could not save the thumbnail. Try again.",
      );
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  }

  const whole = framing.mode === "contain";
  const logZoom = Math.log(framing.zoom);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Adjust thumbnail</DialogTitle>
        <DialogDescription>
          Choose how this piece appears in the collection grid. The photo itself
          is never changed.
        </DialogDescription>
      </DialogHeader>

      <fieldset
        disabled={saving}
        className="mx-auto w-full max-w-[min(100%,20rem)] min-w-0 space-y-3 border-0 p-0"
      >
        <div
          ref={frameRef}
          role="group"
          tabIndex={0}
          aria-label="Thumbnail frame. Use arrow keys to move the photo, plus and minus to zoom."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          className="rounded-xl border-2 border-primary bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "1 / 1",
            overflow: "hidden",
            touchAction: "none",
            cursor: whole ? "default" : "grab",
            userSelect: "none",
          }}
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={(e) =>
              setDims({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            style={
              dims
                ? getFramingStyle(dims.w, dims.h, framing)
                : {
                    position: "absolute",
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }
            }
          />
        </div>

        <div className="flex gap-2" role="radiogroup" aria-label="Framing mode">
          <Button
            type="button"
            size="sm"
            role="radio"
            aria-checked={!whole}
            variant={whole ? "outline" : "default"}
            className="flex-1"
            onClick={() =>
              setFraming((f) => clampFraming({ ...f, mode: "crop" }))
            }
          >
            Square crop
          </Button>
          <Button
            type="button"
            size="sm"
            role="radio"
            aria-checked={whole}
            variant={whole ? "default" : "outline"}
            className="flex-1"
            onClick={() =>
              setFraming((f) =>
                clampFraming({ ...f, mode: "contain", zoom: 1 }),
              )
            }
          >
            Show whole photo
          </Button>
        </div>

        {!whole && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Zoom out"
              onClick={() => setZoom(framing.zoom / 1.25)}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <input
              type="range"
              aria-label="Zoom"
              className="h-8 flex-1"
              min={Math.log(THUMBNAIL_MIN_ZOOM)}
              max={Math.log(THUMBNAIL_MAX_ZOOM)}
              step={0.01}
              value={logZoom}
              onChange={(e) => setZoom(Math.exp(Number(e.target.value)))}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Zoom in"
              onClick={() => setZoom(framing.zoom * 1.25)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {whole
            ? "The whole photo fits inside the square."
            : `Drag to reposition. Zoom ${framing.zoom.toFixed(2)}x. Zooming out may show plain space around the photo.`}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </fieldset>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          onClick={() => void run(null)}
        >
          Use default
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={saving || !dims}
          onClick={() => void run(framing)}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function PotteryThumbnailEditor({
  open,
  onOpenChange,
  ...rest
}: PotteryThumbnailEditorProps) {
  const [saving, setSaving] = useState(false);
  const block = (e: Event) => {
    if (saving) e.preventDefault();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && saving) return;
        onOpenChange(o);
      }}
    >
      <DialogContent
        className="max-h-[100dvh] max-w-md overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        onEscapeKeyDown={block}
        onPointerDownOutside={block}
        onInteractOutside={block}
      >
        {/* Body mounts only while open, keyed by src so a changed photo resets framing. */}
        {open && (
          <EditorBody
            key={rest.src}
            {...rest}
            onSavingChange={setSaving}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Stale prompt (once per photo version per scope per session)
// ---------------------------------------------------------------------------

export interface StaleThumbnailCandidate {
  id: number;
  name: string;
  imageUrl: string;
  thumbnail?: ThumbnailConfigValue | null;
}

const promptedKeys = new Set<string>();

export interface StaleThumbnailPromptProps {
  /** e.g. "gallery" or "detail" so each page prompts independently. */
  scope: string;
  items: StaleThumbnailCandidate[];
  onReframe: (id: number) => void;
  onUseDefault: (id: number) => Promise<void> | void;
}

export function StaleThumbnailPrompt({
  scope,
  items,
  onReframe,
  onUseDefault,
}: StaleThumbnailPromptProps) {
  const [, bump] = useState(0);
  const [busy, setBusy] = useState(false);
  const [latched, setLatched] = useState<{ id: number; key: string } | null>(
    null,
  );
  const keyOf = (c: StaleThumbnailCandidate) =>
    staleThumbnailKey(scope, c.id, c.imageUrl, c.thumbnail);

  // Always resolve the latched candidate against the latest items: if it was
  // refreshed, cleared or re-versioned, the prompt closes instead of acting
  // on a stale snapshot.
  const shown = latched
    ? (items.find(
        (c) =>
          c.id === latched.id &&
          isThumbnailStale(c.imageUrl, c.thumbnail) &&
          keyOf(c) === latched.key,
      ) ?? null)
    : null;
  const next = shown
    ? null
    : items.find(
        (c) =>
          isThumbnailStale(c.imageUrl, c.thumbnail) &&
          !promptedKeys.has(keyOf(c)),
      );

  useEffect(() => {
    if (next) setLatched({ id: next.id, key: keyOf(next) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next?.id, next ? keyOf(next) : ""]);

  const dismiss = () => {
    if (latched) promptedKeys.add(latched.key);
    setLatched(null);
    bump((n) => n + 1);
  };

  return (
    <Dialog open={!!shown} onOpenChange={(o) => !o && !busy && dismiss()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Photo changed</DialogTitle>
          <DialogDescription>
            {shown ? `The photo for "${shown.name}"` : "This photo"} was
            replaced or edited, so its custom thumbnail framing no longer
            applies. The default thumbnail is showing. Reframe it or keep the
            default.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={dismiss}
          >
            Later
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !shown}
            onClick={() => {
              void (async () => {
                if (!shown) return;
                setBusy(true);
                try {
                  await onUseDefault(shown.id);
                  dismiss();
                } catch {
                  /* host surfaces the error; keep prompt open */
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Use default
          </Button>
          <Button
            type="button"
            disabled={busy || !shown}
            onClick={() => {
              const id = shown?.id;
              dismiss();
              if (id !== undefined) onReframe(id);
            }}
          >
            Reframe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
