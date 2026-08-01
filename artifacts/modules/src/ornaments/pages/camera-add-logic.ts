/**
 * Pure, framework-free logic extracted from the camera-add ornament flow.
 *
 * Keeping this separate from the React component means it can be unit-tested
 * directly (no DOM/React renderer required) while still being imported by the
 * component — so any regression in the production code will also break the
 * tests.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type CreateOrnamentResult = { id: number; name?: string | null };

/** Signature compatible with the real `createOrnamentFromImage` API call. */
export type CreateOrnamentFn = (
  formData: FormData,
) => Promise<CreateOrnamentResult>;

/** Signature compatible with the real `uploadOrnamentImage` API call. */
export type UploadOrnamentImageFn = (
  id: number,
  formData: FormData,
) => Promise<unknown>;

export interface PhotoQueueCallbacks {
  /** Called (synchronously, before any await) when the item starts processing. */
  onProcessingStart: () => void;
  /** Called once the first photo has been saved and the new ornament id is known. */
  onCreate: (id: number, name: string | null | undefined) => void;
  /** Called when a supplemental photo upload succeeds. */
  onUpload: () => void;
  /** Called when create or upload throws. The queue continues with the next item. */
  onError: (err: unknown) => void;
}

// ─── Serial photo queue ───────────────────────────────────────────────────────

/**
 * Creates a serial photo-processing queue that guarantees:
 *  • `create` is called **at most once** across all scheduled photos
 *  • Every subsequent photo calls `upload` with the id returned by `create`
 *  • Only one photo is in-flight at a time; the rest wait in an ordered list
 *
 * @param create  Function that uploads the first photo and creates a new ornament.
 * @param upload  Function that uploads additional photos to an existing ornament.
 */
export function createOrnamentPhotoQueue(
  create: CreateOrnamentFn,
  upload: UploadOrnamentImageFn,
) {
  let ornamentId: number | null = null;
  let processing = false;
  const waitlist: Array<() => void> = [];

  /** Returns the ornament id once the first photo has been processed, else null. */
  function getOrnamentId(): number | null {
    return ornamentId;
  }

  async function processPhoto(
    file: File,
    callbacks: PhotoQueueCallbacks,
  ): Promise<void> {
    processing = true;
    callbacks.onProcessingStart();
    try {
      const formData = new FormData();
      formData.append("image", file);

      if (ornamentId === null) {
        const result = await create(formData);
        ornamentId = result.id;
        callbacks.onCreate(result.id, result.name);
      } else {
        await upload(ornamentId, formData);
        callbacks.onUpload();
      }
    } catch (err) {
      callbacks.onError(err);
    } finally {
      processing = false;
      const next = waitlist.shift();
      if (next) next();
    }
  }

  /** Schedule a photo for processing. Safe to call while another is in-flight. */
  function schedulePhoto(file: File, callbacks: PhotoQueueCallbacks): void {
    const run = () => {
      processPhoto(file, callbacks);
    };
    if (!processing) {
      run();
    } else {
      waitlist.push(run);
    }
  }

  return { schedulePhoto, getOrnamentId };
}

// ─── Navigation logic ─────────────────────────────────────────────────────────

/**
 * Derives the navigation target for the "Done adding Ornament" button.
 *
 * Returns `{ kind: "blocked" }` when photos are still in-flight (the caller
 * should show a toast and stay on the page).
 *
 * Returns `{ kind: "navigate", to }` with the route to push otherwise.
 */
export function deriveHandleDoneRoute(
  ornamentId: number | null,
  hasAnyPhotos: boolean,
  stillProcessing: boolean,
): { kind: "blocked" } | { kind: "navigate"; to: string } {
  if (stillProcessing) return { kind: "blocked" };

  if (ornamentId !== null) {
    return {
      kind: "navigate",
      to: `/ornaments/ornament/${ornamentId}?edit=1`,
    };
  }

  if (hasAnyPhotos) {
    // Photos were added but all failed — the ornament was never created.
    // Navigate back to the list so the user can retry.
    return { kind: "navigate", to: "/ornaments" };
  }

  // Barcode-only session: sessionStorage prefill was written on confirmation.
  return { kind: "navigate", to: "/ornaments/add" };
}
