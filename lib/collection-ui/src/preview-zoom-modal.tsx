import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { X, ZoomIn, ZoomOut, Sliders, RotateCcw } from "lucide-react";
import { clampPanToBounds } from "./pan-bounds";

interface PreviewZoomModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

function touchDistance(a: Touch, b: Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchMidpoint(a: Touch, b: Touch) {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

export function PreviewZoomModal({
  open,
  onClose,
  title,
  children,
}: PreviewZoomModalProps) {
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewFilter, setViewFilter] = useState({
    brightness: 100,
    contrast: 100,
    saturation: 100,
  });

  const dragRef = useRef<{
    startX: number;
    startY: number;
    px: number;
    py: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [wheeling, setWheeling] = useState(false);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    };
  }, []);

  // Touch gesture state (single-finger pan, two-finger pinch-zoom).
  const touchRef = useRef<{
    mode: "pan" | "pinch";
    startX: number;
    startY: number;
    px: number;
    py: number;
    startDist: number;
    startZoom: number;
  } | null>(null);
  const [touching, setTouching] = useState(false);
  // Live copies so native (non-React) touch listeners see current values.
  const stateRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  stateRef.current = { zoom, panX, panY };

  const imageFilter = useMemo(() => {
    const { brightness, contrast, saturation } = viewFilter;
    return brightness === 100 && contrast === 100 && saturation === 100
      ? null
      : `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
  }, [viewFilter]);

  useEffect(() => {
    if (open) {
      setZoom(1);
      setPanX(0);
      setPanY(0);
      setViewOpen(false);
    }
  }, [open]);

  // Block native page scroll / pull-to-refresh while the zoom view is open.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.overscrollBehavior = prevOverscroll;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [open, onClose]);

  // Keep the content from being dragged entirely off-screen: clamp against
  // the actual rendered content size, applied on EVERY pan/zoom path.
  const clampPan = useCallback((value: number, axis: "x" | "y", z: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return value;
    const viewport = axis === "x" ? rect.width : rect.height;
    const content = contentRef.current;
    const contentExtent = content
      ? axis === "x"
        ? content.offsetWidth
        : content.offsetHeight
      : viewport;
    return clampPanToBounds(value, viewport, contentExtent || viewport, z);
  }, []);

  // Single entry point for scale changes (toolbar buttons + wheel): always
  // reclamps the existing pan against the new zoom level so zooming out
  // after panning can't leave the content stranded off-screen.
  const applyZoom = useCallback(
    (compute: (prev: number) => number) => {
      setZoom((prev) => {
        const next = Math.min(20, Math.max(0.05, compute(prev)));
        setPanX((px) => clampPan(px, "x", next));
        setPanY((py) => clampPan(py, "y", next));
        return next;
      });
    },
    [clampPan],
  );

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const curX = e.clientX - rect.left - rect.width / 2;
      const curY = e.clientY - rect.top - rect.height / 2;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setWheeling(true);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = setTimeout(() => setWheeling(false), 150);
      setZoom((prev) => {
        const next = Math.min(20, Math.max(0.05, prev * factor));
        const ratio = next / prev;
        setPanX((px) => clampPan(curX * (1 - ratio) + px * ratio, "x", next));
        setPanY((py) => clampPan(curY * (1 - ratio) + py * ratio, "y", next));
        return next;
      });
    },
    [clampPan],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !open) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [open, handleWheel]);

  // Native touch listeners (passive: false so preventDefault suppresses
  // browser scroll/zoom/pull-to-refresh).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !open) return;

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const { zoom: z, panX: px, panY: py } = stateRef.current;
      if (e.touches.length >= 2) {
        const [a, b] = [e.touches[0]!, e.touches[1]!];
        const mid = touchMidpoint(a, b);
        touchRef.current = {
          mode: "pinch",
          startX: mid.x,
          startY: mid.y,
          px,
          py,
          startDist: touchDistance(a, b),
          startZoom: z,
        };
      } else if (e.touches.length === 1) {
        const t = e.touches[0]!;
        touchRef.current = {
          mode: "pan",
          startX: t.clientX,
          startY: t.clientY,
          px,
          py,
          startDist: 0,
          startZoom: z,
        };
      }
      setTouching(true);
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const state = touchRef.current;
      const rect = el.getBoundingClientRect();
      if (!state) return;

      if (state.mode === "pinch" && e.touches.length >= 2) {
        const [a, b] = [e.touches[0]!, e.touches[1]!];
        const mid = touchMidpoint(a, b);
        const dist = touchDistance(a, b);
        const nextZoom = Math.min(
          20,
          Math.max(0.05, state.startZoom * (dist / state.startDist)),
        );
        const ratio = nextZoom / state.startZoom;
        // Zoom about the initial pinch midpoint, then follow midpoint drift.
        const curX = state.startX - rect.left - rect.width / 2;
        const curY = state.startY - rect.top - rect.height / 2;
        const nextPanX =
          curX * (1 - ratio) + state.px * ratio + (mid.x - state.startX);
        const nextPanY =
          curY * (1 - ratio) + state.py * ratio + (mid.y - state.startY);
        setZoom(nextZoom);
        setPanX(clampPan(nextPanX, "x", nextZoom));
        setPanY(clampPan(nextPanY, "y", nextZoom));
      } else if (state.mode === "pan" && e.touches.length === 1) {
        const t = e.touches[0]!;
        const z = stateRef.current.zoom;
        setPanX(clampPan(state.px + (t.clientX - state.startX), "x", z));
        setPanY(clampPan(state.py + (t.clientY - state.startY), "y", z));
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        touchRef.current = null;
        setTouching(false);
      } else if (e.touches.length === 1) {
        // Pinch ended with one finger still down — continue as pan.
        const t = e.touches[0]!;
        const { zoom: z, panX: px, panY: py } = stateRef.current;
        touchRef.current = {
          mode: "pan",
          startX: t.clientX,
          startY: t.clientY,
          px,
          py,
          startDist: 0,
          startZoom: z,
        };
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [open, clampPan]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      px: panX,
      py: panY,
    };
    setDragging(true);
    e.preventDefault();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const nextX = dragRef.current.px + (e.clientX - dragRef.current.startX);
    const nextY = dragRef.current.py + (e.clientY - dragRef.current.startY);
    setPanX(clampPan(nextX, "x", zoom));
    setPanY(clampPan(nextY, "y", zoom));
  };

  const handleMouseUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const resetView = () => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" onClick={onClose}>
      {/* Toolbar */}
      <div
        className="flex shrink-0 items-center gap-2 border-b bg-background px-3 py-1.5 shadow"
        onClick={(e) => e.stopPropagation()}
      >
        {title ? (
          <span className="mr-auto max-w-xs truncate text-sm font-medium text-foreground">
            {title}
          </span>
        ) : (
          <div className="flex-1" />
        )}

        {/* View adjustments */}
        <div className="relative">
          <button
            onClick={() => setViewOpen((v) => !v)}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
              viewOpen || imageFilter
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            View
            {imageFilter && (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </button>
          {viewOpen && (
            <div className="absolute right-0 top-full z-10 mt-1.5 w-64 rounded-xl border border-border bg-popover p-4 shadow-lg">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold">View adjustments</p>
                {imageFilter && (
                  <button
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setViewFilter({
                        brightness: 100,
                        contrast: 100,
                        saturation: 100,
                      })
                    }
                  >
                    Reset
                  </button>
                )}
              </div>
              {(
                [
                  { key: "brightness", label: "Brightness", min: 50, max: 150 },
                  { key: "contrast", label: "Contrast", min: 50, max: 150 },
                  { key: "saturation", label: "Saturation", min: 0, max: 200 },
                ] as const
              ).map(({ key, label, min, max }) => (
                <div key={key} className="mb-3 last:mb-0">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {label}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {viewFilter[key]}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={5}
                    value={viewFilter[key]}
                    onChange={(e) =>
                      setViewFilter((prev) => ({
                        ...prev,
                        [key]: Number(e.target.value),
                      }))
                    }
                    className="h-1.5 w-full cursor-pointer accent-primary"
                  />
                </div>
              ))}
              <p className="mt-1 text-[10px] text-muted-foreground/60">
                Preview only — doesn't affect saved data
              </p>
            </div>
          )}
        </div>

        <div className="h-4 w-px bg-border" />

        {/* Zoom controls */}
        <div className="flex items-center gap-0.5">
          <button
            title="Zoom out"
            onClick={() => applyZoom((v) => v / 1.3)}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <button
            title="Zoom in"
            onClick={() => applyZoom((v) => v * 1.3)}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            title="Reset view"
            onClick={resetView}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="h-4 w-px bg-border" />

        <button
          title="Close (Esc)"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden bg-[#1c1c1e]"
        style={{
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
          overscrollBehavior: "none",
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          ref={contentRef}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${zoom})`,
            transformOrigin: "center center",
            transition:
              wheeling || dragging || touching
                ? "none"
                : "transform 0.15s ease-out",
            filter: imageFilter ?? undefined,
            userSelect: "none",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
