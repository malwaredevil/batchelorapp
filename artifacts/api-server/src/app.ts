import express, {
  type Express,
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import pinoHttp from "pino-http";
import multer from "multer";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { ZodError } from "zod";
import * as SentryNode from "@sentry/node";
import router from "./routes";
import { logger } from "./lib/logger";
import { env } from "./lib/env";
import { sessionMiddleware } from "./lib/session";
import { csrfGuard } from "./middleware/csrf";
import { recordResponseStatus } from "./lib/error-tracker";
const SLOW_REQUEST_THRESHOLD_MS = 2_000;

const app: Express = express();

// Trust the Replit reverse proxy so req.secure / req.ip reflect the real
// client connection (needed for Secure cookies and rate limiting).
app.set("trust proxy", 1);

// Security response headers (#331).
// crossOriginEmbedderPolicy is off: COEP blocks Supabase Storage / Maps loads.
// crossOriginOpenerPolicy allows popups for the Google OAuth callback window.
// All other helmet defaults are enabled:
//   X-Content-Type-Options: nosniff
//   X-Frame-Options: DENY
//   Referrer-Policy: no-referrer
//   Strict-Transport-Security (redundant with CDN but harmless in-depth)
//   Permissions-Policy, Origin-Agent-Cluster, X-Permitted-Cross-Domain-Policies
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          // Google Maps JavaScript API
          "https://maps.googleapis.com",
          "https://maps.gstatic.com",
        ],
        styleSrc: [
          "'self'",
          // Tailwind CSS-in-JS and inline style attributes used throughout
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          // Google Maps tiles and Street View imagery
          "https://maps.googleapis.com",
          "https://maps.gstatic.com",
          "https://*.ggpht.com",
        ],
        connectSrc: [
          "'self'",
          // Sentry browser SDK DSN endpoint (*.ingest.sentry.io/<project>)
          "https://*.ingest.sentry.io",
          "https://*.sentry.io",
          // Google Maps Places/Directions/Geocoding API calls from the browser
          "https://maps.googleapis.com",
        ],
        workerSrc: ["'self'", "blob:"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Slow-request detection: log a warn when any request takes more than 2 s.
// Must be mounted AFTER pinoHttp so req.log is available.
app.use((req: Request, res: Response, next: NextFunction) => {
  const t0 = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - t0;
    recordResponseStatus(res.statusCode);
    if (ms >= SLOW_REQUEST_THRESHOLD_MS) {
      req.log.warn(
        { durationMs: ms, method: req.method, path: req.path },
        "slow-request",
      );
    }
  });
  next();
});

app.use("/api/quilting/blocks/detect-seams", express.json({ limit: "5mb" }));
// Barcode photo extraction endpoint accepts a base64 data URL JSON payload
// which can reach ~4MB for a typical phone JPEG → base64-encoded image.
app.use("/api/ornaments/barcode-photo-lookup", express.json({ limit: "5mb" }));
// Slack Events API (JSON) and slash commands (form-encoded) both require the
// raw request body for HMAC-SHA256 signature verification. Two separate paths
// are used so each can have the correct body parser (json vs urlencoded) with
// rawBody capture. Both must be mounted before the global parsers below.
app.use(
  "/api/slack/webhook",
  express.json({
    limit: "512kb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);
app.use(
  "/api/slack/slash",
  express.urlencoded({
    extended: false,
    limit: "64kb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);
// AgentPhone webhook signatures are HMAC'd over the raw request body, so the
// exact bytes must be captured before body-parser reformats them as JSON.
app.use(
  "/api/agentphone/webhook",
  express.json({
    limit: "64kb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);
// Resend inbound-email webhook signatures are HMAC'd over the raw request
// body (Svix format), so the exact bytes must be captured before body-parser
// reformats them as JSON. Limit is higher than AgentPhone's since email
// bodies (subject/text/html/headers) run larger than SMS/voice payloads.
app.use(
  "/api/elaine/email-webhook",
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(cookieParser(env.sessionSecret));
app.use(sessionMiddleware);

app.use("/api", csrfGuard);
app.use("/api", router);

// Sentry error handler must come before the custom error handler.
// Using expressErrorHandler() directly avoids the ensureIsWrapped() check
// that fires a startup warning when Express is esbuild-bundled (not loaded
// as a separate module). Error capture behaviour is identical.
if (env.sentryDsn) {
  app.use(SentryNode.expressErrorHandler() as unknown as ErrorRequestHandler);
}

// Centralised error handler. Express 5 forwards async errors here automatically.
app.use(
  (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (res.headersSent) return;

    if (err instanceof multer.MulterError) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "Image is too large. Please upload a photo under 10 MB."
          : "Could not process the uploaded file.";
      res.status(400).json({ error: message });
      return;
    }

    if (err instanceof ZodError) {
      const details = err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      req.log.info({ details }, "request validation error");
      res.status(400).json({ error: "Invalid request.", details });
      return;
    }

    // HTTP errors thrown explicitly with a status code (e.g. { status: 404, message: "..." })
    if (
      err &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as { status: unknown }).status === "number"
    ) {
      const { status, message } = err as { status: number; message?: string };
      res.status(status).json({ error: message ?? "Request failed." });
      return;
    }

    req.log.error({ err }, "unhandled request error");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  },
);

export default app;
