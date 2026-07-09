function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export const env = {
  sessionSecret: required("SESSION_SECRET"),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  openrouterApiKey: required("OPENROUTER_API_KEY"),
  jinaApiKey: optional("JINA_API_KEY"),
  voyageApiKey: optional("VOYAGE_API_KEY"),
  googleClientId: optional("GOOGLE_CLIENT_ID"),
  googleClientSecret: optional("GOOGLE_CLIENT_SECRET"),
  googleMapsApiKey: optional("GOOGLE_MAPS_API_KEY"),
  googleWalletServiceAccountJson: optional(
    "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON",
  ),
  googleWalletIssuerId: optional("GOOGLE_WALLET_ISSUER_ID"),
  isProduction: process.env.NODE_ENV === "production",
  // Dev-only automation: lets the automated screenshot tool log in as a fixed
  // account (AGENT_LOGIN_EMAIL) without a browser-driven form submission, so
  // it can capture authenticated screenshots. Never usable in production even
  // if both are somehow set there (see routes/dev-screenshot-login.ts).
  // NOTE: intentionally a plain (non-secret) env var, not a Replit secret —
  // the agent must be able to read its literal value to construct screenshot
  // tool URLs, which the secrets store never allows. This is low-risk: the
  // route is hard-gated to non-production and can only ever authenticate as
  // the single fixed AGENT_LOGIN_EMAIL account.
  screenshotAuthToken: optional("DEV_SCREENSHOT_TOKEN"),
  agentLoginEmail: optional("AGENT_LOGIN_EMAIL"),
  // Shared secret from AgentPhone's webhook configuration screen, used to
  // verify the HMAC signature on inbound `/api/agentphone/webhook` requests.
  // Optional at the env layer so the rest of the app boots fine without it —
  // the webhook route itself returns 503 until this is set.
  agentphoneWebhookSecret: optional("AGENTPHONE_WEBHOOK_SECRET"),
  // Resend inbound-email webhook signing secret for
  // `/api/elaine/email-webhook`. Two separate webhooks were provisioned in
  // Resend (one per environment domain), so the secret to verify against is
  // chosen by NODE_ENV — never mix them up, since a dev-signed payload will
  // fail verification against the prod secret and vice versa.
  resendWebhookSecret: optional(
    process.env.NODE_ENV === "production"
      ? "RESEND_WEBHOOK_SECRET_PROD"
      : "RESEND_WEBHOOK_SECRET_DEV",
  ),
  sentryDsn: optional("SENTRY_DSN"),
};
