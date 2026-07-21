import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import { env } from "./env";

const PgStore = connectPgSimple(session);

export const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;

export const sessionMiddleware = session({
  name: "batchelor.sid",
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new PgStore({
    pool,
    tableName: "app_sessions",
    createTableIfMissing: false,
  }),
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: THIRTY_DAYS_MS,
  },
});
