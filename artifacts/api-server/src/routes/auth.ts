import { Router, type IRouter, type Request } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, and, gt, isNull } from "drizzle-orm";
import { db, pool, appUsers, passwordResetTokens } from "@workspace/db";
import {
  LoginBody,
  LoginResponse,
  GetCurrentUserResponse,
  UpdateCurrentUserBody,
  UpdateCurrentUserResponse,
  GetAuthProvidersResponse,
  ChangePasswordBody,
  ForgotPasswordBody,
  ResetPasswordBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middleware/auth";
import { loginLimiter } from "../middleware/rateLimit";
import { env } from "../lib/env";
import {
  googleEnabled,
  createGoogleClient,
  GOOGLE_SCOPES,
} from "../lib/google-oauth";
import { sendPasswordResetEmail, resendConfigured } from "../lib/email";

const LOGIN_PATH = "/login";
const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;

// A throwaway bcrypt hash computed once at startup. When a login is attempted
// for an email that does not exist, we still run bcrypt.compare against this so
// the response time is the same whether or not the account exists — closing the
// timing side channel that would otherwise reveal which emails are registered.
// The input is random, so no real password can ever match it.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  crypto.randomBytes(32).toString("hex"),
  10,
);

/**
 * Build the OAuth redirect URI from the incoming request so it works across the
 * dev preview domain and the published production domain. The Host is validated
 * against REPLIT_DOMAINS so a forged Host header cannot shape the redirect URI.
 * Returns null when the host is not recognised.
 */
function googleCallbackUrl(req: Request): string | null {
  const host = req.get("host");
  if (!host) return null;
  const allowed = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(host)) return null;
  return `${req.protocol}://${host}/api/auth/google/callback`;
}

const router: IRouter = Router();

router.post("/auth/login", loginLimiter, async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email or password." });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const rememberMe = parsed.data.rememberMe === true;

  const [user] = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.email, email))
    .limit(1);

  // Always run bcrypt.compare — against the user's hash when present, otherwise
  // against a dummy hash — so the timing does not reveal whether the email is
  // registered. The verdict still depends on the real account existing.
  const passwordMatches = await bcrypt.compare(
    parsed.data.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  if (!user || !passwordMatches) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  req.session.regenerate((err) => {
    if (err) {
      req.log.error({ err }, "session regenerate failed");
      res
        .status(500)
        .json({ error: "Could not sign you in. Please try again." });
      return;
    }
    req.session.userId = user.id;
    // Extend cookie lifetime only when the user explicitly asked to be remembered
    if (rememberMe) {
      req.session.cookie.maxAge = THIRTY_DAYS_MS;
    } else {
      // Session cookie: expires when the browser is closed
      req.session.cookie.expires = undefined;
      req.session.cookie.maxAge = undefined as unknown as number;
    }
    res.json(LoginResponse.parse({ id: user.id, email: user.email }));
  });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("pottery.sid");
    res.status(204).end();
  });
});

router.get("/auth/me", requireAuth, async (req, res) => {
  const [user] = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.id, req.session.userId!))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json(
    GetCurrentUserResponse.parse({
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? null,
      themePreference: user.themePreference ?? null,
    }),
  );
});

const VALID_THEMES = new Set(["light", "dark"]);

router.patch("/auth/me", requireAuth, async (req, res) => {
  const parsed = UpdateCurrentUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid account settings." });
    return;
  }

  const updates: Partial<{
    displayName: string | null;
    themePreference: string | null;
  }> = {};

  if (parsed.data.displayName !== undefined) {
    const name = parsed.data.displayName;
    updates.displayName =
      name === null ? null : name.trim().slice(0, 100) || null;
  }
  if (parsed.data.themePreference !== undefined) {
    const theme = parsed.data.themePreference;
    updates.themePreference = theme && VALID_THEMES.has(theme) ? theme : null;
  }

  let user;
  if (Object.keys(updates).length > 0) {
    [user] = await db
      .update(appUsers)
      .set(updates)
      .where(eq(appUsers.id, req.session.userId!))
      .returning();
  } else {
    [user] = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, req.session.userId!))
      .limit(1);
  }

  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json(
    UpdateCurrentUserResponse.parse({
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? null,
      themePreference: user.themePreference ?? null,
    }),
  );
});

router.get("/auth/providers", (_req, res) => {
  res.json(GetAuthProvidersResponse.parse({ google: googleEnabled() }));
});

router.post("/auth/change-password", requireAuth, async (req, res) => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Current password and new password are required." });
    return;
  }

  const { currentPassword, newPassword } = parsed.data;

  if (newPassword.length < 8) {
    res
      .status(400)
      .json({ error: "New password must be at least 8 characters." });
    return;
  }

  const [user] = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.id, req.session.userId!))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const currentMatches = await bcrypt.compare(
    currentPassword,
    user.passwordHash,
  );
  if (!currentMatches) {
    res.status(401).json({ error: "Current password is incorrect." });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(appUsers)
    .set({ passwordHash: newHash })
    .where(eq(appUsers.id, user.id));

  // Revoke ALL sessions for this user (including the current one) so that any
  // stolen session cookie stops working immediately. Then regenerate the
  // session ID and restore the user's identity so they stay logged in under a
  // fresh, unguessable session that the attacker does not possess.
  const savedUserId = req.session.userId!;
  try {
    await pool.query(
      `DELETE FROM quilting_sessions WHERE sess->>'userId' = $1`,
      [String(user.id)],
    );
  } catch (err) {
    req.log.error({ err }, "failed to revoke sessions on password change");
  }

  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = savedUserId;
      req.session.save((saveErr) => {
        if (saveErr) return reject(saveErr);
        resolve();
      });
    });
  });

  res.status(204).end();
});

const THIRTY_MINUTES_MS = 1000 * 60 * 30;

router.post("/auth/forgot-password", loginLimiter, async (req, res) => {
  if (!resendConfigured()) {
    res
      .status(503)
      .json({ error: "Password reset is not available right now." });
    return;
  }

  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid email address is required." });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();

  // Always respond 204 regardless of whether the email is registered —
  // this prevents account enumeration. Critically, we respond *before* doing
  // the async work (token insert + outbound email API call) so that registered
  // and unregistered addresses produce the same response latency. Awaiting the
  // email send would leave a measurable timing side channel even though the
  // HTTP status is identical for both branches.
  const [user] = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.email, email))
    .limit(1);

  res.status(204).end();

  if (!user) {
    return;
  }

  // All remaining work is fire-and-forget; the response has already been sent.
  void (async () => {
    try {
      // Generate a cryptographically random token; store only the SHA-256 hash.
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");

      const expiresAt = new Date(Date.now() + THIRTY_MINUTES_MS);

      // Revoke any outstanding (unused, unexpired) tokens for this user before
      // issuing a fresh one. This ensures that only the newest reset link is
      // valid, so a prior token obtained by an attacker (e.g. from a forwarded
      // email) cannot be replayed after the victim initiates a new reset.
      await db
        .update(passwordResetTokens)
        .set({ used: true, usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.userId, user.id),
            eq(passwordResetTokens.used, false),
          ),
        );

      await db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      // Build the reset URL from the incoming request host (validated against
      // REPLIT_DOMAINS like the Google OAuth flow).
      const host = req.get("host");
      const allowed = (process.env.REPLIT_DOMAINS ?? "")
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);
      const hostOk = !allowed.length || allowed.includes(host ?? "");
      const baseUrl =
        hostOk && host
          ? `${req.protocol}://${host}`
          : `https://${allowed[0] ?? "localhost"}`;

      const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

      await sendPasswordResetEmail(user.email, resetUrl);
    } catch (err) {
      req.log.error({ err }, "failed to send password reset email");
    }
  })();
});

router.post("/auth/reset-password", async (req, res) => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Token and new password are required." });
    return;
  }

  const { token, newPassword } = parsed.data;

  if (newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = new Date();

  const [record] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        gt(passwordResetTokens.expiresAt, now),
        isNull(passwordResetTokens.usedAt),
        eq(passwordResetTokens.used, false),
      ),
    )
    .limit(1);

  if (!record) {
    res
      .status(400)
      .json({ error: "This reset link is invalid, expired, or already used." });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 12);

  // Mark token used and update password atomically in a single transaction
  await db.transaction(async (tx) => {
    await tx
      .update(passwordResetTokens)
      .set({ used: true, usedAt: now })
      .where(eq(passwordResetTokens.id, record.id));
    await tx
      .update(appUsers)
      .set({ passwordHash: newHash })
      .where(eq(appUsers.id, record.userId));
  });

  // Revoke ALL sessions for this user so that any stolen session cookie is
  // immediately invalidated. Password reset is the primary account recovery
  // mechanism; it must not leave existing sessions alive.
  try {
    await pool.query(
      `DELETE FROM quilting_sessions WHERE sess->>'userId' = $1`,
      [String(record.userId)],
    );
  } catch (err) {
    req.log.error({ err }, "failed to revoke sessions on password reset");
  }

  res.status(204).end();
});

const TEN_MINUTES_MS = 1000 * 60 * 10;
const OAUTH_STATE_COOKIE = "pottery.oauth_state";
// Restrict the state cookie to the auth routes that use it.
const OAUTH_COOKIE_PATH = "/api/auth";

// Step 1: begin the Google sign-in flow
router.get("/auth/google", loginLimiter, (req, res) => {
  if (!googleEnabled()) {
    res.redirect(`${LOGIN_PATH}?error=google_unavailable`);
    return;
  }
  const callbackUrl = googleCallbackUrl(req);
  if (!callbackUrl) {
    res.redirect(`${LOGIN_PATH}?error=google_failed`);
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  // Carry the CSRF state in a short-lived, signed, HttpOnly cookie instead of
  // the server-side session store. This means an unauthenticated caller hitting
  // this public endpoint never causes a persistent quilting_sessions row to be
  // written — closing a cheap session-store flooding vector. The session is
  // only created/regenerated in the callback after a real login succeeds.
  res.cookie(OAUTH_STATE_COOKIE, state, {
    signed: true,
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: TEN_MINUTES_MS,
    path: OAUTH_COOKIE_PATH,
  });
  const url = createGoogleClient(callbackUrl).generateAuthUrl({
    access_type: "online",
    scope: GOOGLE_SCOPES,
    state,
    prompt: "select_account",
  });
  res.redirect(url);
});

// Step 2: Google redirects back here with a one-time code
router.get("/auth/google/callback", async (req, res) => {
  if (!googleEnabled()) {
    res.redirect(`${LOGIN_PATH}?error=google_unavailable`);
    return;
  }

  const { code, state } = req.query;
  const expectedState = req.signedCookies?.[OAUTH_STATE_COOKIE];
  // One-time use: clear the state cookie regardless of outcome. The attributes
  // must match those it was set with so every browser reliably deletes it.
  res.clearCookie(OAUTH_STATE_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: OAUTH_COOKIE_PATH,
  });

  if (
    typeof code !== "string" ||
    typeof state !== "string" ||
    typeof expectedState !== "string" ||
    !expectedState ||
    state !== expectedState
  ) {
    res.redirect(`${LOGIN_PATH}?error=google_failed`);
    return;
  }

  const callbackUrl = googleCallbackUrl(req);
  if (!callbackUrl) {
    res.redirect(`${LOGIN_PATH}?error=google_failed`);
    return;
  }

  try {
    const client = createGoogleClient(callbackUrl);
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) {
      res.redirect(`${LOGIN_PATH}?error=google_failed`);
      return;
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.googleClientId,
    });
    const payload = ticket.getPayload();
    const email = payload?.email?.trim().toLowerCase();

    if (!email || payload?.email_verified !== true) {
      res.redirect(`${LOGIN_PATH}?error=google_failed`);
      return;
    }

    const [user] = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.email, email))
      .limit(1);

    if (!user) {
      res.redirect(`${LOGIN_PATH}?error=google_not_allowed`);
      return;
    }

    req.session.regenerate((err) => {
      if (err) {
        req.log.error({ err }, "session regenerate failed (google)");
        res.redirect(`${LOGIN_PATH}?error=google_failed`);
        return;
      }
      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) {
          req.log.error({ err: saveErr }, "session save failed (google)");
          res.redirect(`${LOGIN_PATH}?error=google_failed`);
          return;
        }
        res.redirect("/");
      });
    });
  } catch (err) {
    req.log.warn(
      { reason: err instanceof Error ? err.message : "unknown" },
      "google oauth callback failed",
    );
    res.redirect(`${LOGIN_PATH}?error=google_failed`);
  }
});

export default router;
