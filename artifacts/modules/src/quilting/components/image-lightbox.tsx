import { useEffect, useRef, useCallback } from "react";
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface ImageLightboxProps {
  src: string;
  alt?: string;
  open: boolean;
  onClose: () => void;
  images?: string[];
  currentIndex?: number;
  onNavigate?: (index: number) => void;
  labels?: string[];
}

export function ImageLightbox({
  src,
  alt = "",
  open,
  onClose,
  images,
  currentIndex,
  onNavigate,
  labels,
}: ImageLightboxProps) {
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const isMulti =
    images &&
    images.length > 1 &&
    onNavigate !== undefined &&
    currentIndex !== undefined;

  const applyTransform = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    img.style.transform = `translate(${offsetRef.current.x}px, ${offsetRef.current.y}px) scale(${scaleRef.current})`;
  }, []);

  const resetTransform = useCallback(() => {
    scaleRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    applyTransform();
  }, [applyTransform]);

  useEffect(() => {
    if (!open) {
      scaleRef.current = 1;
      offsetRef.current = { x: 0, y: 0 };
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (isMulti && onNavigate && currentIndex !== undefined) {
        if (e.key === "ArrowLeft" && currentIndex > 0) {
          resetTransform();
          onNavigate(currentIndex - 1);
        }
        if (e.key === "ArrowRight" && currentIndex < images!.length - 1) {
          resetTransform();
          onNavigate(currentIndex + 1);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    open,
    onClose,
    isMulti,
    onNavigate,
    currentIndex,
    images,
    resetTransform,
  ]);

  useEffect(() => {
    resetTransform();
  }, [src, resetTransform]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/88"
      onClick={onClose}
    >
      <button
        className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm hover:bg-white/25 transition-colors"
        onClick={onClose}
        title="Close (Esc)"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5 pointer-events-none select-none">
        <p className="text-xs text-white/50">
          {isMulti
            ? `${(currentIndex ?? 0) + 1} / ${images!.length} · scroll to zoom · drag to pan`
            : "Scroll to zoom · drag to pan · click outside to close"}
        </p>
        {labels && labels[currentIndex ?? 0] && (
          <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-white/80 backdrop-blur-sm">
            {labels[currentIndex ?? 0]}
          </span>
        )}
      </div>

      {isMulti && onNavigate && currentIndex !== undefined && (
        <>
          <button
            className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm hover:bg-white/30 transition-colors disabled:opacity-20 disabled:pointer-events-none"
            onClick={(e) => {
              e.stopPropagation();
              resetTransform();
              onNavigate(currentIndex - 1);
            }}
            disabled={currentIndex === 0}
            title="Previous (←)"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm hover:bg-white/30 transition-colors disabled:opacity-20 disabled:pointer-events-none"
            onClick={(e) => {
              e.stopPropagation();
              resetTransform();
              onNavigate(currentIndex + 1);
            }}
            disabled={currentIndex === images!.length - 1}
            title="Next (→)"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      <div className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2 flex items-center gap-1 rounded-full bg-white/12 px-2 py-1.5 backdrop-blur-sm">
        <button
          className="flex h-7 w-7 items-center justify-center rounded-full text-white hover:bg-white/20 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            scaleRef.current = Math.max(0.15, scaleRef.current / 1.35);
            applyTransform();
          }}
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-full text-white hover:bg-white/20 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            resetTransform();
          }}
          title="Reset (100%)"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-full text-white hover:bg-white/20 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            scaleRef.current = Math.min(12, scaleRef.current * 1.35);
            applyTransform();
          }}
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
      </div>

      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        style={{
          cursor: "grab",
          maxWidth: "88vw",
          maxHeight: "88vh",
          objectFit: "contain",
          userSelect: "none",
          transition: "none",
          willChange: "transform",
        }}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => {
          e.stopPropagation();
          const factor = e.deltaY < 0 ? 1.15 : 0.87;
          scaleRef.current = Math.min(
            12,
            Math.max(0.15, scaleRef.current * factor),
          );
          applyTransform();
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          dragRef.current = {
            sx: e.clientX,
            sy: e.clientY,
            ox: offsetRef.current.x,
            oy: offsetRef.current.y,
          };
          if (imgRef.current) imgRef.current.style.cursor = "grabbing";
        }}
        onMouseMove={(e) => {
          if (!dragRef.current) return;
          offsetRef.current = {
            x: dragRef.current.ox + (e.clientX - dragRef.current.sx),
            y: dragRef.current.oy + (e.clientY - dragRef.current.sy),
          };
          applyTransform();
        }}
        onMouseUp={() => {
          dragRef.current = null;
          if (imgRef.current) imgRef.current.style.cursor = "grab";
        }}
        onMouseLeave={() => {
          dragRef.current = null;
          if (imgRef.current) imgRef.current.style.cursor = "grab";
        }}
      />
    </div>
  );
}
