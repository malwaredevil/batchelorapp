import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  Check,
  Minus,
  Plus,
  Crop,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImageEditorProps {
  file: File;
  onSave: (edited: File) => void;
  onCancel: () => void;
}

type HandleId = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragKind =
  | { kind: "handle"; id: HandleId }
  | { kind: "move" }
  | { kind: "pan" };

interface DragState {
  type: DragKind;
  startNx: number;
  startNy: number;
  /** Raw canvas-pixel position at drag start — used by pan to avoid normalised-coord feedback. */
  startCx: number;
  startCy: number;
  startCrop: CropRect;
  startPanX: number;
  startPanY: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Full image — used as a sentinel for "no crop applied". */
const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 };

/** Initial crop box when the user taps "Crop" — well inset from edges. */
const DEFAULT_CROP: CropRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

const MIN_DIM = 0.04;
const HANDLE_HIT = 24; // canvas-px hit radius (generous for touch)
const HANDLE_R = 10; // drawn circle radius

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Compute the largest rectangle inside (cw × ch) that preserves the
 * image's natural aspect ratio (iw × ih).  This is the "letterbox fit rect".
 */
function fitRect(cw: number, ch: number, iw: number, ih: number) {
  const imgAR = iw / ih;
  const canvasAR = cw / ch;
  if (imgAR > canvasAR) {
    // Image wider than canvas → black bars top/bottom
    const dw = cw;
    const dh = cw / imgAR;
    return { dx: 0, dy: (ch - dh) / 2, dw, dh };
  } else {
    // Image taller than canvas → black bars left/right
    const dh = ch;
    const dw = ch * imgAR;
    return { dx: (cw - dw) / 2, dy: 0, dw, dh };
  }
}

/** Which source region of the image is visible at the current zoom/pan. */
function viewport(iw: number, ih: number, z: number, px: number, py: number) {
  const sw = iw / z;
  const sh = ih / z;
  const sx = clamp(px * iw - sw / 2, 0, iw - sw);
  const sy = clamp(py * ih - sh / 2, 0, ih - sh);
  return { sx, sy, sw, sh };
}

/** Image-normalised (0-1) → canvas pixel, respecting the fit rect. */
function normToCanvas(
  nx: number,
  ny: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  iw: number,
  ih: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
) {
  return {
    cx: dx + ((nx * iw - sx) / sw) * dw,
    cy: dy + ((ny * ih - sy) / sh) * dh,
  };
}

/** Canvas pixel → image-normalised (0-1), respecting the fit rect. */
function canvasToNorm(
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  iw: number,
  ih: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
) {
  return {
    nx: (((cx - dx) / dw) * sw + sx) / iw,
    ny: (((cy - dy) / dh) * sh + sy) / ih,
  };
}

/** Canvas pixel coordinates of the 8 crop handles. */
function handlePoints(
  cl: number,
  ct: number,
  rw: number,
  rh: number,
): { id: HandleId; x: number; y: number }[] {
  return [
    { id: "tl", x: cl, y: ct },
    { id: "tc", x: cl + rw / 2, y: ct },
    { id: "tr", x: cl + rw, y: ct },
    { id: "ml", x: cl, y: ct + rh / 2 },
    { id: "mr", x: cl + rw, y: ct + rh / 2 },
    { id: "bl", x: cl, y: ct + rh },
    { id: "bc", x: cl + rw / 2, y: ct + rh },
    { id: "br", x: cl + rw, y: ct + rh },
  ];
}

/** Apply a handle drag delta (image-normalised units) to a crop rect. */
function applyHandle(
  start: CropRect,
  id: HandleId,
  dnx: number,
  dny: number,
): CropRect {
  let left = start.x;
  let right = start.x + start.w;
  let top = start.y;
  let bot = start.y + start.h;

  if (id === "tl" || id === "ml" || id === "bl") left = clamp(left + dnx, 0, 1);
  if (id === "tr" || id === "mr" || id === "br")
    right = clamp(right + dnx, 0, 1);
  if (id === "tl" || id === "tc" || id === "tr") top = clamp(top + dny, 0, 1);
  if (id === "bl" || id === "bc" || id === "br") bot = clamp(bot + dny, 0, 1);

  if (left > right) [left, right] = [right, left];
  if (top > bot) [top, bot] = [bot, top];
  if (right - left < MIN_DIM) right = Math.min(1, left + MIN_DIM);
  if (bot - top < MIN_DIM) bot = Math.min(1, top + MIN_DIM);

  return { x: left, y: top, w: right - left, h: bot - top };
}

// ---------------------------------------------------------------------------
// Sharpening (unsharp mask convolution — applied at export time only)
// ---------------------------------------------------------------------------

/**
 * Applies a Laplacian sharpening kernel in-place to the canvas context.
 * amount 0-100:  0 = no effect, 25 = mild, 50 = moderate, 100 = strong.
 * Kernel: centre = 1+4a, cross-neighbours = -a  (sum = 1, no brightness shift).
 */
function applySharpen(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  amount: number,
) {
  if (amount <= 0) return;
  const a = (amount / 100) * 1.2; // 0–1.2 range
  const center = 1 + 4 * a;
  const imageData = ctx.getImageData(0, 0, w, h);
  const src = new Uint8ClampedArray(imageData.data); // preserve original
  const dst = imageData.data;
  for (let y = 0; y < h; y++) {
    const yn = Math.max(0, y - 1);
    const ys = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const iN = (yn * w + x) * 4;
      const iS = (ys * w + x) * 4;
      const iW = (y * w + Math.max(0, x - 1)) * 4;
      const iE = (y * w + Math.min(w - 1, x + 1)) * 4;
      for (let c = 0; c < 3; c++) {
        dst[i + c] = Math.max(
          0,
          Math.min(
            255,
            Math.round(
              center * src[i + c] -
                a * (src[iN + c] + src[iS + c] + src[iW + c] + src[iE + c]),
            ),
          ),
        );
      }
      // alpha channel untouched
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImageEditor({ file, onSave, onCancel }: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<ImageBitmap | null>(null);
  const dragRef = useRef<DragState | null>(null);
  /** All currently-active pointer positions, keyed by pointerId. */
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  /** State captured at the start of a pinch gesture. */
  const pinchRef = useRef<{
    startDist: number;
    startZoom: number;
    startPanX: number;
    startPanY: number;
    /** Image-normalised (0-1) position of the pinch midpoint. */
    midNx: number;
    midNy: number;
  } | null>(null);

  const [loaded, setLoaded] = useState(false);
  const [rotation, setRotation] = useState(0); // multiples of 90°
  const [flipH, setFlipH] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [sharpness, setSharpness] = useState(25); // 0-100; applied at export only
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0.5);
  const [panY, setPanY] = useState(0.5);
  const [crop, setCrop] = useState<CropRect>(FULL);
  const [cropMode, setCropMode] = useState(false);

  // Stable ref so pointer handlers never go stale without re-binding.
  const live = useRef({
    zoom,
    panX,
    panY,
    crop,
    cropMode,
    rotation,
    flipH,
    brightness,
    contrast,
    sharpness,
  });
  useEffect(() => {
    live.current = {
      zoom,
      panX,
      panY,
      crop,
      cropMode,
      rotation,
      flipH,
      brightness,
      contrast,
      sharpness,
    };
  });

  // ---------------------------------------------------------------------------
  // Load source image
  // createImageBitmap with imageOrientation:"from-image" is Chrome/Edge-only
  // and applies EXIF rotation automatically — essential for Android camera shots.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    createImageBitmap(file, { imageOrientation: "from-image" })
      .then((bitmap) => {
        if (!cancelled) {
          imgRef.current = bitmap;
          setLoaded(true);
        }
      })
      .catch(() => {
        // Fallback: load via <img> (no EXIF correction) if API unavailable
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          if (!cancelled) {
            // Draw to offscreen canvas to get an ImageBitmap equivalent
            const oc = document.createElement("canvas");
            oc.width = img.naturalWidth;
            oc.height = img.naturalHeight;
            oc.getContext("2d")!.drawImage(img, 0, 0);
            oc.toBlob((blob) => {
              if (!blob || cancelled) return;
              createImageBitmap(blob)
                .then((bmp) => {
                  if (!cancelled) {
                    imgRef.current = bmp;
                    setLoaded(true);
                  }
                })
                .catch(() => {});
            });
          }
          URL.revokeObjectURL(url);
        };
        img.src = url;
      });
    return () => {
      cancelled = true;
      imgRef.current?.close();
      imgRef.current = null;
    };
  }, [file]);

  // ---------------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const {
      zoom: z,
      panX: px,
      panY: py,
      crop: c,
      cropMode: cm,
      brightness: br,
      contrast: co,
    } = live.current;

    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.width;
    const ih = img.height;

    const { sx, sy, sw, sh } = viewport(iw, ih, z, px, py);
    const { dx, dy, dw, dh } = fitRect(cw, ch, iw, ih);
    const ctx = canvas.getContext("2d")!;

    // Black background (fills letterbox bars)
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);

    // Image — drawn into the fit rect only, preserving aspect ratio
    ctx.filter = `brightness(${br}%) contrast(${co}%)`;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.filter = "none";

    // Crop overlay — only rendered when crop mode is active
    if (!cm) return;

    const { cx: cl, cy: ct } = normToCanvas(
      c.x,
      c.y,
      dx,
      dy,
      dw,
      dh,
      iw,
      ih,
      sx,
      sy,
      sw,
      sh,
    );
    const { cx: cr, cy: cb } = normToCanvas(
      c.x + c.w,
      c.y + c.h,
      dx,
      dy,
      dw,
      dh,
      iw,
      ih,
      sx,
      sy,
      sw,
      sh,
    );
    const rw = cr - cl;
    const rh = cb - ct;

    // Darken outside the crop box (clipped to the fit rect)
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(dx, dy, dw, ct - dy); // above
    ctx.fillRect(dx, cb, dw, dy + dh - cb); // below
    ctx.fillRect(dx, ct, cl - dx, rh); // left
    ctx.fillRect(cr, ct, dx + dw - cr, rh); // right

    // White border
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.strokeRect(cl, ct, rw, rh);

    // Rule-of-thirds guide lines
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(cl + (rw * i) / 3, ct);
      ctx.lineTo(cl + (rw * i) / 3, cb);
      ctx.moveTo(cl, ct + (rh * i) / 3);
      ctx.lineTo(cr, ct + (rh * i) / 3);
    }
    ctx.stroke();

    // Handles — circle with generous size for touch friendliness
    for (const h of handlePoints(cl, ct, rw, rh)) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = "white";
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, []); // intentionally empty — always reads live.current

  useEffect(() => {
    if (loaded) draw();
  }, [loaded, zoom, panX, panY, crop, cropMode, brightness, contrast, draw]);

  // Keep canvas pixel size = CSS size (crisp render, handles device resize)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      if (imgRef.current) draw();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  // ---------------------------------------------------------------------------
  // Pointer helpers
  // ---------------------------------------------------------------------------
  function pointerNorm(e: React.PointerEvent | PointerEvent) {
    const canvas = canvasRef.current!;
    const img = imgRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (e.clientY - rect.top) * (canvas.height / rect.height);
    const { zoom: z, panX: px, panY: py } = live.current;
    const iw = img.width;
    const ih = img.height;
    const { sx, sy, sw, sh } = viewport(iw, ih, z, px, py);
    const { dx, dy, dw, dh } = fitRect(canvas.width, canvas.height, iw, ih);
    const norm = canvasToNorm(cx, cy, dx, dy, dw, dh, iw, ih, sx, sy, sw, sh);
    return { cx, cy, ...norm };
  }

  /** Convert raw client coords to image-normalised (0-1), reading current live state. */
  function clientToNorm(clientX: number, clientY: number) {
    const canvas = canvasRef.current!;
    const img = imgRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cx = (clientX - rect.left) * (canvas.width / rect.width);
    const cy = (clientY - rect.top) * (canvas.height / rect.height);
    const { zoom: z, panX: px, panY: py } = live.current;
    const iw = img.width;
    const ih = img.height;
    const { sx, sy, sw, sh } = viewport(iw, ih, z, px, py);
    const { dx, dy, dw, dh } = fitRect(canvas.width, canvas.height, iw, ih);
    return canvasToNorm(cx, cy, dx, dy, dw, dh, iw, ih, sx, sy, sw, sh);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!loaded) return;
    canvasRef.current!.setPointerCapture(e.pointerId);

    // Track all active pointers
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two fingers → start pinch, cancel any active single-finger drag
    if (pointersRef.current.size === 2) {
      dragRef.current = null;
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const { nx: midNx, ny: midNy } = clientToNorm(midX, midY);
      const { zoom: z, panX: px, panY: py } = live.current;
      pinchRef.current = {
        startDist: dist,
        startZoom: z,
        startPanX: px,
        startPanY: py,
        midNx,
        midNy,
      };
      return;
    }

    // Single finger → existing drag logic
    const { cx, cy, nx, ny } = pointerNorm(e);
    const canvas = canvasRef.current!;
    const img = imgRef.current!;
    const { zoom: z, panX: px, panY: py, crop: c, cropMode: cm } = live.current;
    const iw = img.width;
    const ih = img.height;
    const { sx, sy, sw, sh } = viewport(iw, ih, z, px, py);
    const { dx, dy, dw, dh } = fitRect(canvas.width, canvas.height, iw, ih);

    if (cm) {
      // In crop mode: try handles first, then move interior, then pan
      const cl = dx + ((c.x * iw - sx) / sw) * dw;
      const ct = dy + ((c.y * ih - sy) / sh) * dh;
      const cr = dx + (((c.x + c.w) * iw - sx) / sw) * dw;
      const cb = dy + (((c.y + c.h) * ih - sy) / sh) * dh;

      for (const h of handlePoints(cl, ct, cr - cl, cb - ct)) {
        if (Math.hypot(cx - h.x, cy - h.y) <= HANDLE_HIT) {
          dragRef.current = {
            type: { kind: "handle", id: h.id },
            startNx: nx,
            startNy: ny,
            startCx: cx,
            startCy: cy,
            startCrop: c,
            startPanX: px,
            startPanY: py,
          };
          return;
        }
      }

      if (cx >= cl && cx <= cr && cy >= ct && cy <= cb) {
        dragRef.current = {
          type: { kind: "move" },
          startNx: nx,
          startNy: ny,
          startCx: cx,
          startCy: cy,
          startCrop: c,
          startPanX: px,
          startPanY: py,
        };
        return;
      }
    }

    // Outside crop box / not in crop mode → pan (only when zoomed)
    if (z > 1) {
      dragRef.current = {
        type: { kind: "pan" },
        // Store raw canvas pixels so the pan delta is computed in stable pixel-space,
        // not in normalised coords that shift as panX/panY evolve during the drag.
        startNx: nx,
        startNy: ny,
        startCx: cx,
        startCy: cy,
        startCrop: c,
        startPanX: px,
        startPanY: py,
      };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    // Keep pointer map current
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Pinch gesture — two active fingers
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const newZoom = clamp(pinch.startZoom * (dist / pinch.startDist), 1, 5);
      const half = 1 / (2 * newZoom);
      // Zoom toward the midpoint: keep the pinch centre fixed in image space
      const newPanX = clamp(
        pinch.startPanX +
          (pinch.midNx - pinch.startPanX) * (1 - pinch.startZoom / newZoom),
        half,
        1 - half,
      );
      const newPanY = clamp(
        pinch.startPanY +
          (pinch.midNy - pinch.startPanY) * (1 - pinch.startZoom / newZoom),
        half,
        1 - half,
      );
      setZoom(newZoom);
      setPanX(newPanX);
      setPanY(newPanY);
      return;
    }

    // Single-finger drag
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.type.kind === "pan") {
      // Pan uses raw canvas-pixel delta from the drag-start position.
      // Using pointerNorm() here causes a feedback loop: as panX/panY update,
      // pointerNorm returns different normalised coords for the same screen pixel,
      // which makes subsequent move events produce near-zero deltas (pan stalls).
      const canvas = canvasRef.current!;
      const img = imgRef.current!;
      const rect = canvas.getBoundingClientRect();
      const pxRatio = canvas.width / rect.width;
      const curCx = (e.clientX - rect.left) * pxRatio;
      const curCy = (e.clientY - rect.top) * pxRatio;
      const dcx = curCx - drag.startCx;
      const dcy = curCy - drag.startCy;
      // Convert canvas-pixel delta → normalised image delta.
      // dw canvas pixels spans (iw/z) source pixels = 1/z of the image width.
      const z = live.current.zoom;
      const { dw, dh } = fitRect(
        canvas.width,
        canvas.height,
        img.width,
        img.height,
      );
      const dnx = dcx / dw / z;
      const dny = dcy / dh / z;
      const half = 1 / (2 * z);
      // Subtract: dragging right (+dcx) pans left (image follows finger)
      setPanX(clamp(drag.startPanX - dnx, half, 1 - half));
      setPanY(clamp(drag.startPanY - dny, half, 1 - half));
      return;
    }

    const { nx, ny } = pointerNorm(e);
    const dnx = nx - drag.startNx;
    const dny = ny - drag.startNy;

    if (drag.type.kind === "handle") {
      setCrop(applyHandle(drag.startCrop, drag.type.id, dnx, dny));
    } else {
      // move — drag the crop box
      setCrop({
        ...drag.startCrop,
        x: clamp(drag.startCrop.x + dnx, 0, 1 - drag.startCrop.w),
        y: clamp(drag.startCrop.y + dny, 0, 1 - drag.startCrop.h),
      });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    dragRef.current = null;
  }

  // ---------------------------------------------------------------------------
  // Zoom
  // ---------------------------------------------------------------------------
  function changeZoom(newZoom: number) {
    const half = 1 / (2 * newZoom);
    setPanX((p) => clamp(p, half, 1 - half));
    setPanY((p) => clamp(p, half, 1 - half));
    setZoom(newZoom);
  }

  // ---------------------------------------------------------------------------
  // Crop mode
  // ---------------------------------------------------------------------------
  function enterCropMode() {
    setCrop(DEFAULT_CROP);
    setCropMode(true);
  }

  function cancelCrop() {
    setCrop(FULL);
    setCropMode(false);
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------
  function handleSave() {
    const img = imgRef.current;
    if (!img) return;
    const {
      crop: c,
      rotation: rot,
      flipH: fh,
      brightness: br,
      contrast: co,
      sharpness: sharp,
    } = live.current;
    const iw = img.width;
    const ih = img.height;

    const sx = Math.max(0, Math.round(c.x * iw));
    const sy = Math.max(0, Math.round(c.y * ih));
    const sw = Math.min(Math.round(c.w * iw), iw - sx);
    const sh = Math.min(Math.round(c.h * ih), ih - sy);

    const r = ((rot % 4) + 4) % 4;
    const swapped = r % 2 !== 0;
    const outW = swapped ? sh : sw;
    const outH = swapped ? sw : sh;

    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext("2d")!;
    ctx.filter = `brightness(${br}%) contrast(${co}%)`;
    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate((r * Math.PI) / 2);
    if (fh) ctx.scale(r % 2 === 0 ? -1 : 1, r % 2 !== 0 ? -1 : 1);
    ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();

    // Sharpening — pixel-level convolution; applied after brightness/contrast bake-in
    applySharpen(ctx, outW, outH, sharp);

    out.toBlob(
      (blob) => {
        if (!blob) return;
        const base = file.name.replace(/\.[^.]+$/, "");
        onSave(new File([blob], `${base}-edited.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.95,
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black"
      style={{ overscrollBehavior: "none" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold text-white">Edit photo</span>
        <button
          type="button"
          onClick={handleSave}
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
        >
          <Check className="h-4 w-4" />
          Done
        </button>
      </div>

      {/* Canvas — flex-1 fills remaining height */}
      <canvas
        ref={canvasRef}
        className="flex-1 touch-none select-none"
        style={{ cursor: cropMode ? "crosshair" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {/* Contextual hint */}
      <div className="pointer-events-none flex justify-center py-1">
        <span className="rounded-full bg-black/60 px-3 py-1 text-xs text-white/70">
          {cropMode
            ? "Drag handles to resize · drag inside box to move · Done to save"
            : zoom > 1
              ? "Pinch to zoom · drag to pan · tap Crop to select a region"
              : "Pinch to zoom · tap Crop to select a region · use slider below to adjust"}
        </span>
      </div>

      {/* Controls */}
      <div className="space-y-3 border-t border-white/10 bg-black/90 px-4 py-4">
        {/* Zoom */}
        <div className="space-y-1">
          <Label className="text-xs text-white/60">
            Zoom {zoom.toFixed(1)}×
          </Label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => changeZoom(Math.max(1, zoom - 0.5))}
              className="text-white/50 hover:text-white transition"
            >
              <Minus className="h-4 w-4" />
            </button>
            <Slider
              min={1}
              max={5}
              step={0.1}
              value={[zoom]}
              onValueChange={([v]) => changeZoom(v)}
              className="flex-1 [&_[role=slider]]:bg-white"
            />
            <button
              type="button"
              onClick={() => changeZoom(Math.min(5, zoom + 0.5))}
              className="text-white/50 hover:text-white transition"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Transform + Crop */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setRotation((r) => r - 1)}
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-xs text-white/80 hover:bg-white/20 transition"
          >
            <RotateCcw className="h-4 w-4" /> ↺ Left
          </button>
          <button
            type="button"
            onClick={() => setRotation((r) => r + 1)}
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-xs text-white/80 hover:bg-white/20 transition"
          >
            <RotateCw className="h-4 w-4" /> ↻ Right
          </button>
          <button
            type="button"
            onClick={() => setFlipH((f) => !f)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-2 text-xs transition",
              flipH
                ? "bg-primary/30 text-primary"
                : "bg-white/10 text-white/80 hover:bg-white/20",
            )}
          >
            <FlipHorizontal className="h-4 w-4" /> Flip
          </button>

          {cropMode ? (
            <button
              type="button"
              onClick={cancelCrop}
              className="flex items-center gap-1.5 rounded-full bg-red-500/20 px-3 py-2 text-xs text-red-300 hover:bg-red-500/30 transition"
            >
              <X className="h-4 w-4" /> Cancel crop
            </button>
          ) : (
            <button
              type="button"
              onClick={enterCropMode}
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-xs text-white/80 hover:bg-white/20 transition"
            >
              <Crop className="h-4 w-4" /> Crop
            </button>
          )}
        </div>

        {/* Brightness / Contrast / Sharpness */}
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-white/60">
              Brightness {brightness}%
            </Label>
            <Slider
              min={20}
              max={200}
              step={1}
              value={[brightness]}
              onValueChange={([v]) => setBrightness(v)}
              className="[&_[role=slider]]:bg-white"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-white/60">
              Contrast {contrast}%
            </Label>
            <Slider
              min={20}
              max={200}
              step={1}
              value={[contrast]}
              onValueChange={([v]) => setContrast(v)}
              className="[&_[role=slider]]:bg-white"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-white/60">Sharpen {sharpness}</Label>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[sharpness]}
              onValueChange={([v]) => setSharpness(v)}
              className="[&_[role=slider]]:bg-white"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setZoom(1);
            setPanX(0.5);
            setPanY(0.5);
            setRotation(0);
            setFlipH(false);
            setBrightness(100);
            setContrast(100);
            setSharpness(25);
            setCrop(FULL);
            setCropMode(false);
          }}
          className="w-full text-center text-xs text-white/30 hover:text-white/60 transition"
        >
          Reset all
        </button>
      </div>
    </div>
  );
}
