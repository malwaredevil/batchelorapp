/**
 * Shared upload size constants used by both the upload-guard middleware and
 * the Supabase Storage bucket policies.
 *
 * Keeping them in one place guarantees that a bucket policy can never silently
 * exceed the multer limit that acts as the primary rejection point — any edit
 * here propagates to both layers automatically, and the invariant tests in
 * uploadSizeGuard.test.ts will immediately catch a gap if one is introduced.
 *
 * Layering note: this module has no external dependencies so it can be safely
 * imported by lib/ modules (e.g. storage-core.ts) without pulling in any
 * middleware concerns.
 *
 * ## Single-source-of-truth for high-cap routes
 *
 * HIGH_UPLOAD_PREFIXES is the canonical list of route path prefixes that are
 * permitted to receive files up to HIGH_MULTER_FILE_BYTES (20 MB).  Both the
 * global upload-size guard middleware (uploadSizeGuard.ts) and each individual
 * route's multer configuration consult this list via multerLimitForPrefix():
 *
 *   const upload = multer({
 *     storage: multer.memoryStorage(),
 *     limits: { fileSize: multerLimitForPrefix("/api/travels/trips/") },
 *   });
 *
 * Adding a new high-cap route therefore requires only ONE change: add its
 * prefix here.  Both the guard threshold and the per-route multer cap update
 * automatically.  Forgetting to add the prefix means the route silently gets
 * the default 10 MB cap, which is the safe (under-permissive) failure mode
 * rather than a silent security gap.
 */

/**
 * Per-route multer fileSize limit for standard upload routes (pottery,
 * ornaments, quilting). Must stay at least 1 MB below DEFAULT_UPLOAD_BYTES
 * (11 MB) so the global guard is always the primary rejection point.
 */
export const DEFAULT_MULTER_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Per-route multer fileSize limit for high-cap upload routes (travels
 * photos/docs, elaine attachments, messenger). Must stay at least 1 MB below
 * HIGH_UPLOAD_BYTES (21 MB) so the global guard is always the primary
 * rejection point.
 */
export const HIGH_MULTER_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Elaine attachment uploads are intentionally capped well below the standard
 * multer limit — they only accept images + PDFs and are not expected to be
 * large. Defined here so the uploadSizeGuard invariant tests can reference it
 * without importing storage-core (which pulls in env).
 */
export const ELAINE_ATTACHMENT_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Route path prefixes whose uploads are allowed up to HIGH_MULTER_FILE_BYTES
 * (20 MB) through the global upload-size guard.
 *
 * This is the single authoritative list.  The guard middleware reads it to set
 * its per-request threshold, and route files call multerLimitForPrefix() to
 * derive their per-route multer limit from it.  A prefix that is absent from
 * this list causes both the guard AND the per-route multer config to use the
 * default 10 MB cap — the safe, under-permissive failure mode.
 *
 * Rules for adding a new high-cap route:
 *  1. Add its full API path prefix here (must start with "/api/").
 *  2. In the route file call  multerLimitForPrefix("/api/your/prefix/")  to
 *     configure multer — do NOT import HIGH_MULTER_FILE_BYTES directly.
 *  3. Run the tests: the invariant suite in uploadSizeGuard.test.ts will
 *     confirm the prefix is wired up correctly on both sides.
 */
export const HIGH_UPLOAD_PREFIXES: readonly string[] = [
  "/api/travels/trips/", // photos + documents (POST .../photos, .../documents)
  "/api/messenger/attachments/", // messenger file uploads
  "/api/elaine/attachments", // elaine attachment uploads (POST /api/elaine/attachments)
];

/**
 * Return the appropriate multer fileSize limit for the given route prefix.
 *
 * If the prefix (or any leading sub-path of a request that starts with it)
 * appears in HIGH_UPLOAD_PREFIXES, returns HIGH_MULTER_FILE_BYTES (20 MB).
 * Otherwise returns DEFAULT_MULTER_FILE_BYTES (10 MB).
 *
 * Route files should use this instead of importing HIGH_MULTER_FILE_BYTES
 * directly so that the prefix list remains the single source of truth:
 *
 *   const upload = multer({
 *     storage: multer.memoryStorage(),
 *     limits: { fileSize: multerLimitForPrefix("/api/travels/trips/") },
 *   });
 *
 * If the supplied prefix is not yet in HIGH_UPLOAD_PREFIXES the function
 * returns DEFAULT_MULTER_FILE_BYTES.  That is the safe failure mode: uploads
 * are constrained to 10 MB rather than silently receiving the high cap without
 * being listed in the guard.  Add the prefix to HIGH_UPLOAD_PREFIXES to
 * activate the high cap on both the guard and this call site simultaneously.
 */
export function multerLimitForPrefix(routePrefix: string): number {
  const isHigh = HIGH_UPLOAD_PREFIXES.some(
    (p) => routePrefix.startsWith(p) || p.startsWith(routePrefix),
  );
  return isHigh ? HIGH_MULTER_FILE_BYTES : DEFAULT_MULTER_FILE_BYTES;
}
