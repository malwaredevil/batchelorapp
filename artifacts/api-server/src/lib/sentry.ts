import * as Sentry from "@sentry/node";

// @sentry/node is externalized from the esbuild bundle. The SDK is initialized
// once in instrument.mjs (loaded via `--import` before the main bundle runs).
// This module re-exports the Sentry namespace for use in route handlers and
// middleware (e.g. Sentry.captureException, setupExpressErrorHandler).

export { Sentry };
