import sharp from "sharp";

export const MAX_SOURCE_DATA_URL_BYTES = 10 * 1024 * 1024;

export const DEFAULT_INPAINT_PROMPT =
  "flat, smooth fabric with no creases or folds, uniform surface texture, original print pattern preserved exactly";

export interface CropInfo {
  left: number;
  top: number;
  width: number;
  height: number;
  origW: number;
  origH: number;
}

export function validateSourceDataUrl(dataUrl: string): Buffer {
  if (!/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(dataUrl)) {
    throw Object.assign(
      new Error(
        "sourceDataUrl must be a base64-encoded image (jpeg/png/webp/gif).",
      ),
      { status: 400 },
    );
  }
  const b64 = dataUrl.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
  const buf = Buffer.from(b64, "base64");
  if (buf.byteLength > MAX_SOURCE_DATA_URL_BYTES) {
    throw Object.assign(
      new Error(
        `sourceDataUrl exceeds the 10 MB limit (got ${Math.round(buf.byteLength / 1024 / 1024)}MB).`,
      ),
      { status: 400 },
    );
  }
  return buf;
}

/**
 * Preprocess source image + mask into the two format variants required by each
 * inpainting API (OpenAI and Replicate), plus the crop info needed to restore
 * the original image dimensions from the 1024×1024 output.
 */
export async function preprocessForInpaint(
  imgBuffer: Buffer,
  maskDataUrl: string,
): Promise<{
  resizedImg: Buffer;
  openaiMask: Buffer;
  replMask: Buffer;
  cropInfo: CropInfo;
}> {
  const maskB64 = maskDataUrl.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
  const maskBuffer = Buffer.from(maskB64, "base64");

  const origMeta = await sharp(imgBuffer).metadata();
  const origW = origMeta.width ?? 1024;
  const origH = origMeta.height ?? 1024;
  const scale = Math.min(1024 / origW, 1024 / origH);
  const scaledW = Math.round(origW * scale);
  const scaledH = Math.round(origH * scale);
  const cropLeft = Math.round((1024 - scaledW) / 2);
  const cropTop = Math.round((1024 - scaledH) / 2);
  const cropInfo: CropInfo = {
    left: cropLeft,
    top: cropTop,
    width: scaledW,
    height: scaledH,
    origW,
    origH,
  };

  const [resizedImg, rawMask] = await Promise.all([
    sharp(imgBuffer)
      .resize(1024, 1024, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 255 },
      })
      .ensureAlpha()
      .png()
      .toBuffer(),
    sharp(maskBuffer)
      .resize(1024, 1024, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);

  // OpenAI mask: transparent = inpaint area, opaque white = keep.
  // User-painted opaque purple marks creases → invert alpha.
  const openaiMaskData = Buffer.from(rawMask.data);
  for (let i = 3; i < openaiMaskData.length; i += 4) {
    const wasOpaque = openaiMaskData[i] > 10;
    openaiMaskData[i] = wasOpaque ? 0 : 255;
    if (!wasOpaque) {
      openaiMaskData[i - 3] = 255;
      openaiMaskData[i - 2] = 255;
      openaiMaskData[i - 1] = 255;
    }
  }
  const openaiMask = await sharp(openaiMaskData, {
    raw: {
      width: rawMask.info.width,
      height: rawMask.info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();

  // Replicate mask: white = inpaint, black = keep (no alpha).
  const replMaskData = Buffer.from(rawMask.data);
  for (let i = 0; i < replMaskData.length; i += 4) {
    const alpha = replMaskData[i + 3];
    const painted = alpha > 10;
    replMaskData[i] = painted ? 255 : 0;
    replMaskData[i + 1] = painted ? 255 : 0;
    replMaskData[i + 2] = painted ? 255 : 0;
    replMaskData[i + 3] = 255;
  }
  const replMask = await sharp(replMaskData, {
    raw: {
      width: rawMask.info.width,
      height: rawMask.info.height,
      channels: 4,
    },
  })
    .removeAlpha()
    .png()
    .toBuffer();

  return { resizedImg, openaiMask, replMask, cropInfo };
}

/**
 * Build a white-on-transparent PNG mask from percentage-based crease
 * coordinates. The resulting maskDataUrl is compatible with preprocessForInpaint.
 */
export async function buildCreaseMaskDataUrl(
  creases: Array<{
    x1Pct: number;
    y1Pct: number;
    x2Pct: number;
    y2Pct: number;
    widthPct: number;
  }>,
  imageWidth: number,
  imageHeight: number,
): Promise<string> {
  const minDim = Math.min(imageWidth, imageHeight);
  const svgLines = creases
    .map((c) => {
      const x1 = Math.round((c.x1Pct / 100) * imageWidth);
      const y1 = Math.round((c.y1Pct / 100) * imageHeight);
      const x2 = Math.round((c.x2Pct / 100) * imageWidth);
      const y2 = Math.round((c.y2Pct / 100) * imageHeight);
      const sw = Math.max(4, Math.round((c.widthPct / 100) * minDim));
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="white" stroke-width="${sw}" stroke-linecap="round"/>`;
    })
    .join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}">
  <rect width="${imageWidth}" height="${imageHeight}" fill="black" fill-opacity="0"/>
  ${svgLines}
</svg>`;

  const maskBuffer = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .png()
    .toBuffer();
  return `data:image/png;base64,${maskBuffer.toString("base64")}`;
}
