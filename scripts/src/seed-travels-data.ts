/**
 * Seed the travels database with 16 trips and 23 wishlist items
 * from the user's Excel spreadsheet.
 *
 * Uses Supabase REST API (bypasses session auth) so it can be run
 * directly from the dev environment without starting the API server.
 *
 * Usage: pnpm --filter @workspace/scripts run seed-travels
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://gadhlfluflknlwgmlmos.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is not set");
  process.exit(1);
}

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function supabase<T>(
  method: string,
  path: string,
  body?: unknown,
  query = "",
): Promise<T> {
  const url = `${SUPABASE_URL}/rest/v1/${path}${query ? `?${query}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${path}: ${res.status} ${text}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// ─── Trip data ───────────────────────────────────────────────────────────────

const TRIPS: Array<{
  title: string;
  destination: string;
  status: string;
  start_date: string;
  end_date: string;
  travelers: string[];
  the_one_thing: string[];
  traveller_count: number;
  transport_to?: string;
}> = [
  // 2024
  {
    title: "Strasbourg",
    destination: "Strasbourg, France",
    status: "completed",
    start_date: "2024-07-19",
    end_date: "2024-07-21",
    travelers: ["John", "Ashley"],
    the_one_thing: ["Autograph Collection", "River Tour Of City"],
    traveller_count: 2,
    transport_to: "drove",
  },
  {
    title: "Basel",
    destination: "Basel, Switzerland",
    status: "completed",
    start_date: "2024-08-30",
    end_date: "2024-09-01",
    travelers: ["John", "Ashley", "Karis", "Angela"],
    the_one_thing: ["Rhine Falls"],
    traveller_count: 4,
    transport_to: "drove",
  },
  {
    title: "Dornbirn",
    destination: "Dornbirn, Austria",
    status: "completed",
    start_date: "2024-10-11",
    end_date: "2024-10-13",
    travelers: ["John", "Ashley"],
    the_one_thing: ["Cable Car"],
    traveller_count: 2,
    transport_to: "drove",
  },
  {
    title: "Falkenstein",
    destination: "Falkenstein, Germany",
    status: "completed",
    start_date: "2024-10-18",
    end_date: "2024-10-20",
    travelers: ["John", "Ashley", "Karis", "Angela"],
    the_one_thing: ["Autograph Collection", "Haunted House"],
    traveller_count: 4,
    transport_to: "drove",
  },
  {
    title: "Prague",
    destination: "Prague, Czech Republic",
    status: "completed",
    start_date: "2024-11-08",
    end_date: "2024-11-10",
    travelers: ["John", "Ashley"],
    the_one_thing: ["Charles Bridge"],
    traveller_count: 2,
    transport_to: "flew",
  },
  {
    title: "Vienna",
    destination: "Vienna, Austria",
    status: "completed",
    start_date: "2024-12-23",
    end_date: "2024-12-26",
    travelers: ["John", "Ashley", "Karis", "Angela"],
    the_one_thing: ["Christmas Markets"],
    traveller_count: 4,
    transport_to: "drove",
  },
  // 2025
  {
    title: "Lucerne",
    destination: "Lucerne, Switzerland",
    status: "completed",
    start_date: "2025-01-17",
    end_date: "2025-01-19",
    travelers: ["John", "Ashley"],
    the_one_thing: ["Covered Bridges"],
    traveller_count: 2,
    transport_to: "drove",
  },
  {
    title: "Tegernsee",
    destination: "Tegernsee, Germany",
    status: "completed",
    start_date: "2025-02-14",
    end_date: "2025-02-16",
    travelers: ["John", "Ashley"],
    the_one_thing: ["Autograph Collection", "Ferry Trip"],
    traveller_count: 2,
    transport_to: "drove",
  },
  {
    title: "Tokyo",
    destination: "Tokyo, Japan",
    status: "completed",
    start_date: "2025-06-21",
    end_date: "2025-06-27",
    travelers: ["Ashley", "Karis", "Angela"],
    the_one_thing: ["Autograph Collection", "Japanese Culture"],
    traveller_count: 3,
    transport_to: "flew",
  },
  // 2026
  {
    title: "Affalterbach (January)",
    destination: "Affalterbach, Germany",
    status: "completed",
    start_date: "2026-01-16",
    end_date: "2026-01-18",
    travelers: ["John", "Ashley"],
    the_one_thing: ["Autograph Collection"],
    traveller_count: 2,
    transport_to: "drove",
  },
  {
    title: "Baden-Baden (February)",
    destination: "Baden-Baden, Germany",
    status: "completed",
    start_date: "2026-02-13",
    end_date: "2026-02-15",
    travelers: ["John", "Ashley"],
    the_one_thing: ["Autograph Collection", "25th Wedding Anniversary"],
    traveller_count: 2,
    transport_to: "drove",
  },
  {
    title: "Affalterbach (March)",
    destination: "Affalterbach, Germany",
    status: "completed",
    start_date: "2026-03-27",
    end_date: "2026-03-29",
    travelers: ["John", "Ashley"],
    the_one_thing: ["Autograph Collection"],
    traveller_count: 2,
    transport_to: "drove",
  },
  {
    title: "Affalterbach (May)",
    destination: "Affalterbach, Germany",
    status: "completed",
    start_date: "2026-05-22",
    end_date: "2026-05-24",
    travelers: ["John", "Ashley"],
    the_one_thing: ["Autograph Collection", "Walking Tour Of City"],
    traveller_count: 2,
    transport_to: "drove",
  },
  {
    title: "Sheffield",
    destination: "Sheffield, UK",
    status: "completed",
    start_date: "2026-06-10",
    end_date: "2026-06-12",
    travelers: ["John", "Ashley", "Karis", "Angela"],
    the_one_thing: ["Family Vacation"],
    traveller_count: 4,
    transport_to: "flew",
  },
  {
    title: "Baden-Baden (June)",
    destination: "Baden-Baden, Germany",
    status: "completed",
    start_date: "2026-06-19",
    end_date: "2026-06-21",
    travelers: ["John", "Ashley"],
    the_one_thing: ["Autograph Collection", "Rooftop Bar"],
    traveller_count: 2,
    transport_to: "drove",
  },
  {
    title: "Catania, Sicily — John's 50th",
    destination: "Catania, Sicily",
    status: "booked",
    start_date: "2026-08-05",
    end_date: "2026-08-08",
    travelers: ["John", "Ashley", "Karis", "Angela"],
    the_one_thing: ["John's 50th Birthday Vacation"],
    traveller_count: 4,
    transport_to: "flew",
  },
];

// ─── Wishlist data ────────────────────────────────────────────────────────────

const WISHLIST: Array<{ destination: string; done: boolean }> = [
  { destination: "Italy", done: false },
  { destination: "Spain", done: false },
  { destination: "Belgium", done: false },
  { destination: "Netherlands", done: false },
  { destination: "Denmark", done: false },
  { destination: "UK", done: true },
  { destination: "Ireland", done: false },
  { destination: "Scotland", done: false },
  { destination: "Poland", done: false },
  { destination: "Greece", done: false },
  { destination: "Portugal", done: false },
  { destination: "Sweden", done: false },
  { destination: "Norway", done: false },
  { destination: "Slovakia", done: false },
  { destination: "Hungary", done: false },
  { destination: "Slovenia", done: false },
  { destination: "Luxembourg", done: false },
  { destination: "Croatia", done: false },
  { destination: "Sicily, Italy", done: false },
  { destination: "Japan", done: true },
  { destination: "Lake Como, Italy", done: false },
  { destination: "Amsterdam, Netherlands", done: false },
  { destination: "Malta", done: false },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Find the user
  const users = await supabase<Array<{ id: number; email: string }>>(
    "GET",
    "app_users",
    undefined,
    "select=id,email&limit=5",
  );

  if (!users.length) {
    console.error("No users found in app_users. Create an account first.");
    process.exit(1);
  }

  const user = users[0];
  console.log(`Seeding for user: ${user.email} (id=${user.id})`);

  // Check existing trips
  const existingTrips = await supabase<Array<{ id: number }>>(
    "GET",
    "travels_trips",
    undefined,
    `select=id&user_id=eq.${user.id}&limit=1`,
  );

  if (existingTrips.length > 0) {
    console.log(`User already has trips. Skipping trip seed.`);
  } else {
    console.log(`Inserting ${TRIPS.length} trips...`);
    const rows = TRIPS.map((t) => ({
      user_id: user.id,
      title: t.title,
      destination: t.destination,
      status: t.status,
      start_date: t.start_date,
      end_date: t.end_date,
      travelers: t.travelers,
      the_one_thing: t.the_one_thing,
      traveller_count: t.traveller_count,
      transport_to: t.transport_to ?? null,
      has_rental_car: false,
    }));
    await supabase("POST", "travels_trips", rows, "");
    console.log(`  ✓ ${TRIPS.length} trips inserted`);
  }

  // Check existing wishlist
  const existingWishlist = await supabase<Array<{ id: number }>>(
    "GET",
    "travels_wishlist",
    undefined,
    `select=id&user_id=eq.${user.id}&limit=1`,
  );

  if (existingWishlist.length > 0) {
    console.log(`User already has wishlist items. Skipping wishlist seed.`);
  } else {
    console.log(`Inserting ${WISHLIST.length} wishlist items...`);
    const rows = WISHLIST.map((w, i) => ({
      user_id: user.id,
      destination: w.destination,
      done: w.done,
      sort_order: i,
    }));
    await supabase("POST", "travels_wishlist", rows, "");
    console.log(`  ✓ ${WISHLIST.length} wishlist items inserted`);
  }

  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
