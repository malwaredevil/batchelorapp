import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { resolveDatabaseUrl, sslConfig } from "@workspace/db";

const newUsers = [
  { email: "batchelorkm@gmail.com",         displayName: "Karis" },
  { email: "angela.batchelor.fi@gmail.com", displayName: "Angela" },
];

async function main() {
  const client = new pg.Client({ connectionString: resolveDatabaseUrl(), ssl: sslConfig });
  await client.connect();

  for (const u of newUsers) {
    const email = u.email.trim().toLowerCase();

    const { rows } = await client.query<{ id: number }>(
      "SELECT id FROM app_users WHERE email = $1 LIMIT 1",
      [email],
    );

    if (rows.length > 0) {
      console.log(`✓ Already exists (id ${rows[0].id}): ${email}`);
      continue;
    }

    // Random unguessable placeholder — must use Forgot Password to set a real password.
    const placeholder = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(placeholder, 12);

    const insert = await client.query<{ id: number }>(
      `INSERT INTO app_users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [email, passwordHash, u.displayName],
    );

    console.log(`✅ Created (id ${insert.rows[0].id}): ${email}  —  display name "${u.displayName}"`);
    console.log(`   → They need to use Forgot Password on the login page to set their own password.`);
  }

  await client.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
