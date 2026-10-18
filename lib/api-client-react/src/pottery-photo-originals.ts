import { customFetch } from "./custom-fetch";

export interface PotteryPhotoOriginalInfo {
  version: string;
  available: boolean;
  source: "upload" | "existing" | null;
  isCurrentOriginal: boolean;
  imageUrl: string | null;
}

function parseOriginalInfo(
  value: unknown,
  expectedUrl: string,
): PotteryPhotoOriginalInfo {
  if (!value || typeof value !== "object")
    throw new Error("Invalid original-photo response.");
  const data = value as Record<string, unknown>;
  if (
    typeof data.version !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.version) ||
    typeof data.available !== "boolean" ||
    typeof data.isCurrentOriginal !== "boolean" ||
    (data.available
      ? (data.source !== "upload" && data.source !== "existing") ||
        data.imageUrl !== expectedUrl
      : data.source !== null ||
        data.imageUrl !== null ||
        data.isCurrentOriginal)
  ) {
    throw new Error("Invalid original-photo response.");
  }
  return {
    version: data.version,
    available: data.available,
    source: data.source as PotteryPhotoOriginalInfo["source"],
    isCurrentOriginal: data.isCurrentOriginal,
    imageUrl: data.imageUrl as string | null,
  };
}

function originalPhotoPath(itemId: number, imageId: number | null) {
  if (
    !Number.isSafeInteger(itemId) ||
    itemId <= 0 ||
    (imageId !== null && (!Number.isSafeInteger(imageId) || imageId <= 0))
  ) {
    throw new Error("Invalid pottery photo.");
  }
  return `/api/pottery/items/${itemId}/photos/${imageId ?? "primary"}`;
}

export async function getPotteryPhotoOriginalInfo(
  itemId: number,
  imageId: number | null,
) {
  const path = originalPhotoPath(itemId, imageId);
  return parseOriginalInfo(
    await customFetch(`${path}/original-info`),
    `${path}/original`,
  );
}

export async function restorePotteryPhotoOriginal(
  itemId: number,
  imageId: number | null,
  expectedVersion: string,
) {
  const path = originalPhotoPath(itemId, imageId);
  return parseOriginalInfo(
    await customFetch(`${path}/restore-original`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion }),
    }),
    `${path}/original`,
  );
}
