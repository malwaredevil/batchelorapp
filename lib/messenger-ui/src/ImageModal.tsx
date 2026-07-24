import { useEffect, useRef, useCallback } from "react";
import { X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

interface ImageModalProps {
  url: string;
  alt: string;
  onClose: () => void;
}

function touchDist(t1: Touch, t2: Touch): number {
  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;
  return Math.hypot(dx, dy);
}

function touchMid(t1: Touch, t2: Touch): { x: number; y: number } {
  return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
}

export function ImageModal({ url, alt, onClose }: ImageModalProps) {
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const lastTapRef = useRef<number>(0);
  const touchRef = useRef<
    | { type: "pan"; sx: number; sy: number; ox: number; oy: number }
    | {
        type: "pinch";
        initDist: number;
        initScale: number;
        midX: number;
        midY: number;
        ox: number;
        oy: number;
      }
    | null
  >(null);

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
    scaleRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTapRef.current < 300) {
          if (scaleRef.current > 1.5) {
            scaleRef.current = 1;
            offsetRef.current = { x: 0, y: 0 };
          } else {
            scaleRef.current = 2.5;
          }
          applyTransform();
          touchRef.current = null;
          lastTapRef.current = 0;
          return;
        }
        lastTapRef.current = now;
        touchRef.current = {
          type: "pan",
          sx: e.touches[0]!.clientX,
          sy: e.touches[0]!.clientY,
          ox: offsetRef.current.x,
          oy: offsetRef.current.y,
        };
      } else if (e.touches.length === 2) {
        const t1 = e.touches[0]!;
        const t2 = e.touches[1]!;
        const mid = touchMid(t1, t2);
        touchRef.current = {
          type: "pinch",
          initDist: touchDist(t1, t2),
          initScale: scaleRef.current,
          midX: mid.x,
          midY: mid.y,
          ox: offsetRef.current.x,
          oy: offsetRef.current.y,
        };
      }
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      const state = touchRef.current;
      if (!state) return;

      if (state.type === "pan" && e.touches.length === 1) {
        offsetRef.current = {
          x: state.ox + (e.touches[0]!.clientX - state.sx),
          y: state.oy + (e.touches[0]!.clientY - state.sy),
        };
        applyTransform();
      } else if (state.type === "pinch" && e.touches.length === 2) {
        const t1 = e.touches[0]!;
        const t2 = e.touches[1]!;
        const dist = touchDist(t1, t2);
        const ratio = dist / state.initDist;
        const newScale = Math.min(12, Math.max(0.15, state.initScale * ratio));

        const overlay = overlayRef.current;
        if (overlay) {
          const rect = overlay.getBoundingClientRect();
          const cx = state.midX - rect.width / 2;
          const cy = state.midY - rect.height / 2;
          const imgX = (cx - state.ox) / state.initScale;
          const imgY = (cy - state.oy) / state.initScale;
          offsetRef.current = {
            x: cx - imgX * newScale,
            y: cy - imgY * newScale,
          };
        }

        scaleRef.current = newScale;
        applyTransform();
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length === 0) {
        touchRef.current = null;
      } else if (e.touches.length === 1 && touchRef.current?.type === "pinch") {
        touchRef.current = {
          type: "pan",
          sx: e.touches[0]!.clientX,
          sy: e.touches[0]!.clientY,
          ox: offsetRef.current.x,
          oy: offsetRef.current.y,
        };
      }
    }

    img.addEventListener("touchstart", onTouchStart, { passive: false });
    img.addEventListener("touchmove", onTouchMove, { passive: false });
    img.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      img.removeEventListener("touchstart", onTouchStart);
      img.removeEventListener("touchmove", onTouchMove);
      img.removeEventListener("touchend", onTouchEnd);
    };
  }, [applyTransform]);

  const iconBtnStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.85,
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-label="Image preview"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        backgroundColor: "rgba(0,0,0,0.88)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        touchAction: "none",
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close image"
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          background: "rgba(255,255,255,0.15)",
          border: "none",
          borderRadius: "50%",
          width: 40,
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "#fff",
          zIndex: 1,
        }}
      >
        <X size={20} />
      </button>

      <p
        style={{
          position: "absolute",
          top: 20,
          left: "50%",
          transform: "translateX(-50%)",
          color: "rgba(255,255,255,0.4)",
          fontSize: 12,
          pointerEvents: "none",
          userSelect: "none",
          whiteSpace: "nowrap",
          zIndex: 1,
        }}
      >
        Scroll or pinch to zoom · drag to pan · double-tap to reset
      </p>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "rgba(255,255,255,0.12)",
          borderRadius: 9999,
          padding: "6px 8px",
          backdropFilter: "blur(6px)",
          zIndex: 1,
        }}
      >
        <button
          style={iconBtnStyle}
          title="Zoom out"
          onClick={() => {
            scaleRef.current = Math.max(0.15, scaleRef.current / 1.35);
            applyTransform();
          }}
        >
          <ZoomOut size={16} />
        </button>
        <button
          style={iconBtnStyle}
          title="Reset zoom"
          onClick={resetTransform}
        >
          <RotateCcw size={14} />
        </button>
        <button
          style={iconBtnStyle}
          title="Zoom in"
          onClick={() => {
            scaleRef.current = Math.min(12, scaleRef.current * 1.35);
            applyTransform();
          }}
        >
          <ZoomIn size={16} />
        </button>
      </div>

      <img
        ref={imgRef}
        src={url}
        alt={alt}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "88vw",
          maxHeight: "88vh",
          objectFit: "contain",
          cursor: "grab",
          userSelect: "none",
          transition: "none",
          willChange: "transform",
          touchAction: "none",
        }}
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
