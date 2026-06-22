import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import pinoHttp from "pino-http";
import multer from "multer";
import cookieParser from "cookie-parser";
import router from "./routes";
import { logger } from "./lib/logger";
import { env } from "./lib/env";
import { sessionMiddleware } from "./lib/session";
import { csrfGuard } from "./middleware/csrf";

const app: Express = express();

// Trust the Replit reverse proxy so req.secure / req.ip reflect the real
// client connection (needed for Secure cookies and rate limiting).
app.set("trust proxy", 1);

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

app.use("/api/quilting/blocks/detect-seams", express.json({ limit: "5mb" }));
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(cookieParser(env.sessionSecret));
app.use(sessionMiddleware);

app.use("/api", csrfGuard);
app.use("/api", router);

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

    if (
      err &&
      typeof err === "object" &&
      Array.isArray((err as { issues?: unknown }).issues)
    ) {
      res.status(400).json({ error: "Invalid request." });
      return;
    }

    req.log.error({ err }, "unhandled request error");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  },
);

export default app;
