import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    "*.email",
    "*.fromEmail",
    "*.phoneNumber",
    "*.phone",
    "*.from",
    "*.accessToken",
    "*.refreshToken",
    "*.access_token",
    "*.refresh_token",
    "*.token",
    "*.password",
    "*.secret",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
