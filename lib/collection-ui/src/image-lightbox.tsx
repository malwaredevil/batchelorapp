import { useEffect, useRef, useCallback } from "react";
import { clampPanToBounds, useModalFocus } from "./pan-bounds";
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export interface ImageLightboxProps {
  src: string;
  alt?: string;
  /** Optional contextual label shown in the viewer's top control strip. */
  title?: string;
  open: boolean;
  onClose: () => void;
  images?: string[];
  currentIndex?: number;
  onNavigate?: (index: number) => void;
  labels?: string[];
  /** Optional extra action(s) (e.g. "set as cover photo") shown bottom-left, per current index. */
  extraActions?: React.ReactNode | ((index: number) => React.ReactNode);
}

export function ImageLightbox({
  src,
  alt = "",
  title,
  open,
  onClose,
  images,
  currentIndex,
  onNavigate,
  labels,
  extraActions,
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
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const touchRef = useRef<{
    mode: "pan" | "pinch";
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    startDist: number;
    startScale: number;
  } | null>(null);

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

  // Keep the image from being dragged entirely off-screen: clamp against the
  // actual rendered image size, applied on EVERY pan/zoom path.
  const clampOffset = useCallback((x: number, y: number, scale: number) => {
    const img = imgRef.current;
    const w = img?.offsetWidth || window.innerWidth;
    const h = img?.offsetHeight || window.innerHeight;
    return {
      x: clampPanToBounds(x, window.innerWidth, w, scale),
      y: clampPanToBounds(y, window.innerHeight, h, scale),
    };
  }, []);

  // Single entry point for scale changes (wheel + toolbar buttons): always
  // reclamps the current offset against the new scale so zooming out after
  // panning can't leave the image stranded off-screen.
  const applyScale = useCallback(
    (nextScale: number) => {
      scaleRef.current = Math.min(12, Math.max(0.15, nextScale));
      offsetRef.current = clampOffset(
        offsetRef.current.x,
        offsetRef.current.y,
        scaleRef.current,
      );
      applyTransform();
    },
    [clampOffset, applyTransform],
  );

  // Touch pinch-zoom & pan. Native non-passive listeners so preventDefault
  // suppresses browser scroll/zoom/pull-to-refresh while the lightbox is open.
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !open) return;

    const dist = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length >= 2) {
        touchRef.current = {
          mode: "pinch",
          sx: (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2,
          sy: (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2,
          ox: offsetRef.current.x,
          oy: offsetRef.current.y,
          startDist: dist(e.touches[0]!, e.touches[1]!),
          startScale: scaleRef.current,
        };
      } else if (e.touches.length === 1) {
        touchRef.current = {
          mode: "pan",
          sx: e.touches[0]!.clientX,
          sy: e.touches[0]!.clientY,
          ox: offsetRef.current.x,
          oy: offsetRef.current.y,
          startDist: 0,
          startScale: scaleRef.current,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const state = touchRef.current;
      if (!state) return;
      if (state.mode === "pinch" && e.touches.length >= 2) {
        const midX = (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2;
        const midY = (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2;
        const nextScale = Math.min(
          12,
          Math.max(
            0.15,
            state.startScale *
              (dist(e.touches[0]!, e.touches[1]!) / state.startDist),
          ),
        );
        scaleRef.current = nextScale;
        offsetRef.current = clampOffset(
          state.ox + (midX - state.sx),
          state.oy + (midY - state.sy),
          nextScale,
        );
        applyTransform();
      } else if (state.mode === "pan" && e.touches.length === 1) {
        offsetRef.current = clampOffset(
          state.ox + (e.touches[0]!.clientX - state.sx),
          state.oy + (e.touches[0]!.clientY - state.sy),
          scaleRef.current,
        );
        applyTransform();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        touchRef.current = null;
      } else if (e.touches.length === 1) {
        // Pinch ended with one finger down — continue as a pan.
        touchRef.current = {
          mode: "pan",
          sx: e.touches[0]!.clientX,
          sy: e.touches[0]!.clientY,
          ox: offsetRef.current.x,
          oy: offsetRef.current.y,
          startDist: 0,
          startScale: scaleRef.current,
        };
      }
    };

    img.addEventListener("touchstart", onTouchStart, { passive: false });
    img.addEventListener("touchmove", onTouchMove, { passive: false });
    img.addEventListener("touchend", onTouchEnd);
    img.addEventListener("touchcancel", onTouchEnd);
    return () => {
      img.removeEventListener("touchstart", onTouchStart);
      img.removeEventListener("touchmove", onTouchMove);
      img.removeEventListener("touchend", onTouchEnd);
      img.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [open, applyTransform, clampOffset]);

  // Block native page scroll / pull-to-refresh while the lightbox is open.
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

  useModalFocus(open, modalRef, closeButtonRef);

  if (!open) return null;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#08090b] text-white"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "Image viewer"}
      data-testid="image-lightbox"
      tabIndex={-1}
    >
      <div
        className="absolute inset-x-3 top-3 z-10 flex items-start gap-3 sm:inset-x-5 sm:top-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1 space-y-1 pr-12">
          {title && (
            <p className="truncate text-sm font-medium text-white/90">
              {title}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/50">
            <span>
              {isMulti
                ? `${(currentIndex ?? 0) + 1} / ${images!.length}`
                : "Image viewer"}
            </span>
            <span aria-hidden="true">·</span>
            <span>Scroll to zoom · drag to pan</span>
            {labels && labels[currentIndex ?? 0] && (
              <>
                <span aria-hidden="true">·</span>
                <span className="rounded-full bg-white/15 px-2 py-0.5 font-medium text-white/80">
                  {labels[currentIndex ?? 0]}
                </span>
              </>
            )}
          </div>
        </div>
        <button
          ref={closeButtonRef}
          className="absolute right-0 top-0 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/12 text-white backdrop-blur-sm transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close image viewer"
        >
          <X className="h-5 w-5" />
        </button>
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

      {extraActions && (
        <div
          className="absolute bottom-5 left-4 z-10"
          onClick={(e) => e.stopPropagation()}
        >
          {typeof extraActions === "function"
            ? extraActions(currentIndex ?? 0)
            : extraActions}
        </div>
      )}

      <div
        className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/12 px-2 py-1.5 backdrop-blur-sm sm:bottom-5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="flex h-7 w-7 items-center justify-center rounded-full text-white hover:bg-white/20 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            applyScale(scaleRef.current / 1.35);
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
            applyScale(scaleRef.current * 1.35);
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
          touchAction: "none",
        }}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => {
          e.stopPropagation();
          const factor = e.deltaY < 0 ? 1.15 : 0.87;
          applyScale(scaleRef.current * factor);
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
          offsetRef.current = clampOffset(
            dragRef.current.ox + (e.clientX - dragRef.current.sx),
            dragRef.current.oy + (e.clientY - dragRef.current.sy),
            scaleRef.current,
          );
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
