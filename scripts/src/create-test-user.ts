import bcrypt from "bcryptjs";
import crypto from "crypto";

const password = crypto.randomBytes(16).toString("hex");
const email = "agent-test@batchelor.app";
const displayName = "Test Agent";

const passwordHash = await bcrypt.hash(password, 12);

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

const res = await fetch(`${supabaseUrl}/rest/v1/app_users`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Prefer: "resolution=merge-duplicates,return=representation",
  },
  body: JSON.stringify({
    email,
    password_hash: passwordHash,
    display_name: displayName,
    is_owner: false,
  }),
});

if (!res.ok) {
  const err = await res.text();
  throw new Error(`Supabase insert failed: ${res.status} — ${err}`);
}

const rows = (await res.json()) as { id: number; email: string }[];
console.log(`EMAIL=${email}`);
console.log(`PASSWORD=${password}`);
console.log(`USER_ID=${rows[0]?.id ?? "unknown"}`);
