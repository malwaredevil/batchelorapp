import crypto from "node:crypto";
import { env } from "../env";

/**
 * Google Wallet pass generation for trip documents (boarding passes, hotel
 * reservations, etc). Uses the "Save to Google Wallet" JWT-link pattern —
 * we sign a short-lived JWT embedding the pass object directly, rather than
 * inserting objects via the REST API, so no extra Wallet Object Insert call
 * is needed per pass. Pass *classes* (the reusable template) are still
 * created once via REST, idempotently, the first time they're needed.
 *
 * All secrets (service account private key) stay server-side. The only
 * output ever returned to the client is the final `pay.google.com/gp/v/save/…`
 * URL, which is safe to share (it's a signed, single-purpose save link).
 */

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function getServiceAccount(): ServiceAccount {
  if (!env.googleWalletServiceAccountJson) {
    throw new Error("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON is not configured");
  }
  const parsed = JSON.parse(env.googleWalletServiceAccountJson) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON is missing client_email/private_key");
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

function getIssuerId(): string {
  if (!env.googleWalletIssuerId) {
    throw new Error("GOOGLE_WALLET_ISSUER_ID is not configured");
  }
  return env.googleWalletIssuerId;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signRs256(headerObj: unknown, payloadObj: unknown, privateKey: string): string {
  const header = base64url(JSON.stringify(headerObj));
  const payload = base64url(JSON.stringify(payloadObj));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  });
  return `${signingInput}.${base64url(signature)}`;
}

// ── OAuth token exchange (for REST class management) ──────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const account = getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const assertion = signRs256(
    { alg: "RS256", typ: "JWT" },
    {
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/wallet_object.issuer",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    account.private_key,
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Wallet token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

// ── Pass class management (idempotent) ─────────────────────────────────────

const TRIP_DOCUMENT_CLASS_SUFFIX = "batchelor_travel_document";

export function getTripDocumentClassId(): string {
  return `${getIssuerId()}.${TRIP_DOCUMENT_CLASS_SUFFIX}`;
}

export async function ensureTripDocumentClassExists(): Promise<void> {
  const classId = getTripDocumentClassId();
  const token = await getAccessToken();

  const getRes = await fetch(
    `https://walletobjects.googleapis.com/walletobjects/v1/genericClass/${classId}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) },
  );
  if (getRes.ok) return; // already exists

  const createRes = await fetch(
    "https://walletobjects.googleapis.com/walletobjects/v1/genericClass",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: classId }),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!createRes.ok && createRes.status !== 409) {
    const text = await createRes.text().catch(() => "");
    throw new Error(`Failed to create Wallet pass class (${createRes.status}): ${text.slice(0, 300)}`);
  }
}

// ── Save-to-Wallet link generation ─────────────────────────────────────────

export interface TripDocumentPassInput {
  documentId: number;
  documentType: string | null;
  originalFilename: string | null;
  tripTitle: string;
  tripDestination: string;
  extractedData: Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function buildRow(label: string, value: string): { header: string; body: string } | null {
  if (!value) return null;
  return { header: label, body: value };
}

export async function buildSaveToWalletUrl(input: TripDocumentPassInput): Promise<string> {
  const account = getServiceAccount();
  await ensureTripDocumentClassExists();
  const classId = getTripDocumentClassId();
  const ed = input.extractedData ?? {};

  const typeLabel = (input.documentType ?? "travel_document").replace(/_/g, " ");
  const cardTitle =
    str(ed.providerName) ||
    str(ed.hotelName) ||
    input.originalFilename ||
    `${input.tripDestination} ${typeLabel}`;

  const rows = [
    buildRow("Trip", `${input.tripTitle} — ${input.tripDestination}`),
    buildRow("Flight", str(ed.flightNumber)),
    buildRow("From", str(ed.fromLocation)),
    buildRow("To", str(ed.toLocation)),
    buildRow("Departure", str(ed.departureDateTime)),
    buildRow("Arrival", str(ed.arrivalDateTime)),
    buildRow("Hotel", str(ed.hotelName)),
    buildRow("Check-in", str(ed.checkInDate)),
    buildRow("Check-out", str(ed.checkOutDate)),
    buildRow("Confirmation #", str(ed.confirmationNumber) || str(ed.referenceNumber)),
  ].filter((r): r is { header: string; body: string } => r != null);

  const objectId = `${getIssuerId()}.travel_doc_${input.documentId}`;

  const genericObject = {
    id: objectId,
    classId,
    genericType: "GENERIC_TYPE_UNSPECIFIED",
    cardTitle: { defaultValue: { language: "en-US", value: typeLabel.replace(/\b\w/g, (c) => c.toUpperCase()) } },
    subheader: { defaultValue: { language: "en-US", value: cardTitle } },
    header: { defaultValue: { language: "en-US", value: cardTitle } },
    textModulesData: rows.slice(0, 10),
    hexBackgroundColor: "#2563eb",
  };

  const now = Math.floor(Date.now() / 1000);
  const jwt = signRs256(
    { alg: "RS256", typ: "JWT" },
    {
      iss: account.client_email,
      aud: "google",
      typ: "savetowallet",
      iat: now,
      payload: { genericObjects: [genericObject] },
    },
    account.private_key,
  );

  return `https://pay.google.com/gp/v/save/${jwt}`;
}
