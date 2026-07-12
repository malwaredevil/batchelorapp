import { db, travelsTrips } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function tripExists(tripId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  return !!row;
}
