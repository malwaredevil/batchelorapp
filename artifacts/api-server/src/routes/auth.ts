import { Router, type IRouter, type Request } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, and, gt, isNull, desc } from "drizzle-orm";
import {
  db,
  pool,
  appUsers,
  passwordResetTokens,
  phoneVerificationCodes,
} from "@workspace/db";
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
  SendPhoneVerificationCodeBody,
  VerifyPhoneCodeBody,
  VerifyPhoneCodeResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middleware/auth";
import { getSlackUserEmail } from "../lib/slack";
import {
  loginLimiter,
  passwordResetLimiter,
  phoneVerifyLimiter,
} from "../middleware/rateLimit";
import { env } from "../lib/env";
import {
  googleEnabled,
  createGoogleClient,
  GOOGLE_SCOPES,
} from "../lib/google-oauth";
import {
  sendPasswordResetEmail,
  sendTestEmail,
  resendConfigured,
} from "../lib/email";
import {
  sendSms,
  SmsRegistrationPendingError,
  SmsOptedOutError,
} from "../lib/sms";
import { runReminderAlerts } from "../lib/reminder-scheduler";
import { THIRTY_DAYS_MS } from "../lib/session";

const LOGIN_PATH = "/login";

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
  const allowed = env.replitDomains;
  if (!allowed.length) {
    // No allow-list configured. In production this means we cannot validate the
    // Host header, so we fail closed to prevent an open-redirect / auth-code
    // theft via a forged Host header. In development the allow-list is absent
    // by design (preview domain changes on every reboot), so we allow any host.
    if (env.isProduction) return null;
  } else if (!allowed.includes(host)) {
    return null;
  }
  return `${req.protocol}://${host}/api/auth/google/callback`;
}

// All apps (pottery, quilting, travels) share one login page hosted at the
// domain root by the main Batchelor app. Sub-apps hard-redirect unauthenticated
// visitors to "/login?returnTo=<original path>" so this must only ever accept
// a same-origin relative path — never an absolute URL or protocol-relative
// "//host" path — to prevent it being used as an open redirect.
function sanitizeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  return value;
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

    // Fire-and-forget: use every successful login (any user) as an extra
    // trigger point for the shared reminder-alert check, on top of the
    // hourly in-process fallback and the scheduled cron job. This is a
    // single shared function so any future notification channel (SMS, etc.)
    // added to it automatically gets this same trigger for free.
    runReminderAlerts().catch((err: unknown) =>
      req.log.error({ err }, "reminder-scheduler: login-triggered run failed"),
    );
  });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("batchelor.sid", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
    });
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
      isOwner: user.isOwner ?? false,
      phoneNumber: user.phoneNumber ?? null,
      phoneVerified: user.phoneVerified ?? false,
      birthday: user.birthday ?? null,
      slackUserId: user.slackUserId ?? null,
    }),
  );
});

const VALID_THEMES = new Set(["light", "dark"]);
// MM-DD format, e.g. "01-15" for January 15th.
const BIRTHDAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

router.patch("/auth/me", requireAuth, async (req, res) => {
  const parsed = UpdateCurrentUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid account settings." });
    return;
  }

  const updates: Partial<{
    displayName: string | null;
    themePreference: string | null;
    birthday: string | null;
    slackUserId: string | null;
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
  if (parsed.data.birthday !== undefined) {
    const bday = parsed.data.birthday;
    if (bday === null || bday === "") {
      updates.birthday = null;
    } else if (BIRTHDAY_RE.test(bday)) {
      updates.birthday = bday;
    } else {
      res.status(400).json({ error: "Birthday must be in MM-DD format." });
      return;
    }
  }
  if (parsed.data.slackUserId !== undefined) {
    const sid = parsed.data.slackUserId;
    if (sid === null || sid === "") {
      updates.slackUserId = null;
    } else {
      const trimmed = sid.trim();
      // Verify the supplied Slack member ID actually belongs to the
      // authenticated user by fetching its profile email from the Slack API
      // and requiring it to match. This prevents one household member from
      // claiming another person's Slack ID, which would hijack their inbound
      // Elaine messages/commands.
      const [currentUser] = await db
        .select({ email: appUsers.email })
        .from(appUsers)
        .where(eq(appUsers.id, req.session.userId!))
        .limit(1);
      if (!currentUser) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const slackEmail = await getSlackUserEmail(trimmed);
      if (!slackEmail) {
        res.status(400).json({
          error: "Could not verify that Slack ID — check the ID and try again.",
        });
        return;
      }
      if (slackEmail !== currentUser.email.toLowerCase().trim()) {
        res.status(400).json({
          error:
            "The Slack account's email does not match your Batchelor account email. " +
            "You can only link a Slack account that uses the same email address.",
        });
        return;
      }
      updates.slackUserId = trimmed;
    }
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
      isOwner: user.isOwner ?? false,
      phoneNumber: user.phoneNumber ?? null,
      phoneVerified: user.phoneVerified ?? false,
      birthday: user.birthday ?? null,
      slackUserId: user.slackUserId ?? null,
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
  await pool.query(`DELETE FROM app_sessions WHERE sess->>'userId' = $1`, [
    String(user.id),
  ]);

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

const PHONE_CODE_EXPIRY_MS = 1000 * 60 * 10;
const MAX_PHONE_CODE_ATTEMPTS = 5;
// E.164: leading +, 1-9 first digit, up to 15 digits total.
const E164_RE = /^\+[1-9]\d{6,14}$/;

router.post(
  "/auth/phone/send-code",
  requireAuth,
  phoneVerifyLimiter,
  async (req, res) => {
    const parsed = SendPhoneVerificationCodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "A valid phone number is required." });
      return;
    }
    if (parsed.data.consent !== true) {
      res.status(400).json({
        error:
          "You must agree to receive SMS messages before we can text you a code.",
      });
      return;
    }
    const phoneNumber = parsed.data.phoneNumber.trim();

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + PHONE_CODE_EXPIRY_MS);

    try {
      await db.insert(phoneVerificationCodes).values({
        userId: req.session.userId!,
        phoneNumber,
        codeHash,
        expiresAt,
      });
      // Record the opt-in timestamp on the account itself (not just the
      // pending verification row) — this is the durable, carrier-facing
      // evidence of consent for A2P 10DLC campaign registration.
      await db
        .update(appUsers)
        .set({ smsConsentAt: new Date() })
        .where(eq(appUsers.id, req.session.userId!));
      await sendSms(
        phoneNumber,
        `Your Batchelor App verification code is ${code}. It expires in 10 minutes.`,
      );
      res.status(204).end();
    } catch (err) {
      req.log.error({ err }, "failed to send phone verification code");
      if (err instanceof SmsRegistrationPendingError) {
        res.status(503).json({
          error:
            "SMS sending isn't enabled yet — AgentPhone's carrier (10DLC) registration is still pending. Your consent has been recorded and will be used for that registration.",
        });
        return;
      }
      if (err instanceof SmsOptedOutError) {
        res.status(409).json({
          error:
            "This phone number has opted out of texts (replied STOP). Reply START from that phone to resubscribe before verifying it.",
        });
        return;
      }
      res.status(500).json({
        error: "Could not send the verification code. Please try again.",
      });
    }
  },
);

router.post("/auth/phone/verify", requireAuth, async (req, res) => {
  const parsed = VerifyPhoneCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A 6-digit code is required." });
    return;
  }

  const userId = req.session.userId!;
  const now = new Date();

  const [record] = await db
    .select()
    .from(phoneVerificationCodes)
    .where(
      and(
        eq(phoneVerificationCodes.userId, userId),
        eq(phoneVerificationCodes.used, false),
        gt(phoneVerificationCodes.expiresAt, now),
      ),
    )
    .orderBy(desc(phoneVerificationCodes.createdAt))
    .limit(1);

  if (!record || record.attempts >= MAX_PHONE_CODE_ATTEMPTS) {
    res.status(400).json({
      error: "This code is invalid or has expired. Request a new one.",
    });
    return;
  }

  const providedHash = crypto
    .createHash("sha256")
    .update(parsed.data.code)
    .digest("hex");

  // Constant-time compare to avoid a timing side channel on the code digits.
  const matches =
    providedHash.length === record.codeHash.length &&
    crypto.timingSafeEqual(
      Buffer.from(providedHash),
      Buffer.from(record.codeHash),
    );

  if (!matches) {
    const attempts = record.attempts + 1;
    await db
      .update(phoneVerificationCodes)
      .set({
        attempts,
        used: attempts >= MAX_PHONE_CODE_ATTEMPTS,
      })
      .where(eq(phoneVerificationCodes.id, record.id));
    res.status(400).json({
      error: "This code is invalid or has expired. Request a new one.",
    });
    return;
  }

  const [user] = await db.transaction(async (tx) => {
    await tx
      .update(phoneVerificationCodes)
      .set({ used: true })
      .where(eq(phoneVerificationCodes.id, record.id));
    return tx
      .update(appUsers)
      .set({
        phoneNumber: record.phoneNumber,
        phoneVerified: true,
        phoneVerifiedAt: now,
      })
      .where(eq(appUsers.id, userId))
      .returning();
  });

  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  res.json(
    VerifyPhoneCodeResponse.parse({
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? null,
      themePreference: user.themePreference ?? null,
      isOwner: user.isOwner ?? false,
      phoneNumber: user.phoneNumber ?? null,
      phoneVerified: user.phoneVerified ?? false,
    }),
  );
});

router.post(
  "/auth/test-sms",
  requireAuth,
  phoneVerifyLimiter,
  async (req, res) => {
    const [user] = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, req.session.userId!))
      .limit(1);

    if (!user || !user.phoneVerified || !user.phoneNumber) {
      res.status(400).json({
        error: "Verify a phone number first before sending a test SMS.",
      });
      return;
    }

    try {
      await sendSms(
        user.phoneNumber,
        "This is a test SMS from your Batchelor App account settings. If you received this, SMS delivery is working!",
      );
      res.status(204).end();
    } catch (err) {
      req.log.error({ err }, "failed to send test sms");
      if (err instanceof SmsRegistrationPendingError) {
        res.status(503).json({
          error:
            "SMS sending isn't enabled yet — AgentPhone's carrier (10DLC) registration is still pending. Your phone number is verified and ready; this will start working once registration completes.",
        });
        return;
      }
      if (err instanceof SmsOptedOutError) {
        res.status(409).json({
          error:
            "This phone number has opted out of texts (replied STOP). Reply START from that phone to resubscribe.",
        });
        return;
      }
      res.status(500).json({ error: "Could not send the test SMS." });
    }
  },
);

router.post("/auth/test-email", requireAuth, async (req, res) => {
  if (!resendConfigured()) {
    res.status(503).json({ error: "Email is not available right now." });
    return;
  }

  const [user] = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.id, req.session.userId!))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    await sendTestEmail(user.email);
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "failed to send test email");
    res.status(500).json({ error: "Could not send the test email." });
  }
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

      // Atomically revoke any outstanding tokens and issue a fresh one inside
      // a single transaction. The partial unique index on
      // (user_id) WHERE NOT used means only one active token per user can
      // exist — if two simultaneous forgot-password requests both reach this
      // point, the second INSERT hits a unique constraint violation. We catch
      // that and return without sending a second email: the first request's
      // token is already on its way, so the user gets exactly one valid link.
      try {
        await db.transaction(async (tx) => {
          await tx
            .update(passwordResetTokens)
            .set({ used: true, usedAt: new Date() })
            .where(
              and(
                eq(passwordResetTokens.userId, user.id),
                eq(passwordResetTokens.used, false),
              ),
            );
          await tx.insert(passwordResetTokens).values({
            userId: user.id,
            tokenHash,
            expiresAt,
          });
        });
      } catch (err: unknown) {
        // A parallel request already inserted an active token for this user
        // (unique constraint on (user_id) WHERE NOT used). One valid reset
        // link is already in flight — swallow this and skip the email send.
        const pg = err as { code?: string };
        if (pg.code === "23505") {
          req.log.info(
            { userId: user.id },
            "forgot-password: parallel request already issued a token, skipping duplicate",
          );
          return;
        }
        throw err;
      }

      // Build the reset URL from the incoming request host (validated against
      // REPLIT_DOMAINS like the Google OAuth flow).
      const host = req.get("host");
      const allowed = env.replitDomains;
      // Only trust the incoming Host header when it appears in the allow-list.
      // Never fall through with "accept any host" when the list is empty —
      // that would let a forged Host header shape the password-reset link.
      const hostOk = allowed.length > 0 && allowed.includes(host ?? "");
      const baseUrl =
        hostOk && host
          ? `${req.protocol}://${host}`
          : (env.publicAppUrl ?? `https://${allowed[0] ?? "localhost"}`);

      const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

      await sendPasswordResetEmail(user.email, resetUrl);
    } catch (err) {
      req.log.error({ err }, "failed to send password reset email");
    }
  })();
});

router.post("/auth/reset-password", passwordResetLimiter, async (req, res) => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Token and new password are required." });
    return;
  }

  const { token, newPassword } = parsed.data;

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = new Date();

  // Hash the password before opening the transaction so the slow bcrypt work
  // doesn't hold a DB connection for longer than necessary.
  const newHash = await bcrypt.hash(newPassword, 12);

  // Atomically claim the token and update the password in one transaction.
  // The UPDATE...RETURNING approach means only one concurrent request can flip
  // used=false → used=true — any parallel request races to the same row and
  // gets 0 rows back, preventing token replay even under simultaneous requests.
  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(passwordResetTokens)
      .set({ used: true, usedAt: now })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          gt(passwordResetTokens.expiresAt, now),
          isNull(passwordResetTokens.usedAt),
          eq(passwordResetTokens.used, false),
        ),
      )
      .returning({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
      });

    if (!row) return null;

    await tx
      .update(appUsers)
      .set({ passwordHash: newHash })
      .where(eq(appUsers.id, row.userId));

    return row;
  });

  if (!claimed) {
    res
      .status(400)
      .json({ error: "This reset link is invalid, expired, or already used." });
    return;
  }

  // Revoke ALL sessions for this user so that any stolen session cookie is
  // immediately invalidated. Password reset is the primary account recovery
  // mechanism; it must not leave existing sessions alive.
  await pool.query(`DELETE FROM app_sessions WHERE sess->>'userId' = $1`, [
    String(claimed.userId),
  ]);

  res.status(204).end();
});

const TEN_MINUTES_MS = 1000 * 60 * 10;
const OAUTH_STATE_COOKIE = "pottery.oauth_state";
const OAUTH_RETURN_TO_COOKIE = "pottery.oauth_returnto";
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

  // Sub-apps (pottery/quilting/travels) send visitors here with a
  // returnTo=<their original path> so they land back where they started after
  // Google sign-in. Stash it in the same short-lived signed cookie pattern as
  // the CSRF state rather than trusting a query param on the callback, since
  // Google echoes back its own `state` param, not arbitrary app state.
  const returnTo = sanitizeReturnTo(req.query.returnTo);
  if (returnTo) {
    res.cookie(OAUTH_RETURN_TO_COOKIE, returnTo, {
      signed: true,
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: TEN_MINUTES_MS,
      path: OAUTH_COOKIE_PATH,
    });
  } else {
    res.clearCookie(OAUTH_RETURN_TO_COOKIE, { path: OAUTH_COOKIE_PATH });
  }

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
  const returnTo = sanitizeReturnTo(
    req.signedCookies?.[OAUTH_RETURN_TO_COOKIE],
  );
  // One-time use: clear the state cookies regardless of outcome. The
  // attributes must match those they were set with so every browser reliably
  // deletes them.
  res.clearCookie(OAUTH_STATE_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: OAUTH_COOKIE_PATH,
  });
  res.clearCookie(OAUTH_RETURN_TO_COOKIE, {
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
        res.redirect(returnTo ?? "/");

        // Same shared trigger as password login — see comment there.
        runReminderAlerts().catch((err: unknown) =>
          req.log.error(
            { err },
            "reminder-scheduler: login-triggered run failed (google)",
          ),
        );
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
