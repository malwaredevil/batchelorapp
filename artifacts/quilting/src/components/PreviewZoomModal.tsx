import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { X, ZoomIn, ZoomOut, Sliders, RotateCcw } from "lucide-react";

interface PreviewZoomModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
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

  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [open, onClose]);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const curX = e.clientX - rect.left - rect.width / 2;
      const curY = e.clientY - rect.top - rect.height / 2;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom((prev) => {
        const next = Math.min(20, Math.max(0.05, prev * factor));
        const ratio = next / prev;
        setPanX((px) => curX * (1 - ratio) + px * ratio);
        setPanY((py) => curY * (1 - ratio) + py * ratio);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !open) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [open, handleWheel]);

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
    setPanX(dragRef.current.px + (e.clientX - dragRef.current.startX));
    setPanY(dragRef.current.py + (e.clientY - dragRef.current.startY));
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
    <div
      className="fixed inset-0 z-50 flex flex-col"
      onClick={onClose}
    >
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
            onClick={() => setZoom((v) => Math.max(0.05, v / 1.3))}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <button
            title="Zoom in"
            onClick={() => setZoom((v) => Math.min(20, v * 1.3))}
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
        style={{ cursor: dragging ? "grabbing" : "grab" }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${zoom})`,
            transformOrigin: "center center",
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
