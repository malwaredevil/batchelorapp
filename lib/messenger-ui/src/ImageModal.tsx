import { useEffect, useRef, useCallback } from "react";
import { X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

interface ImageModalProps {
  url: string;
  alt: string;
  onClose: () => void;
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
        Scroll to zoom · drag to pan · click outside to close
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
