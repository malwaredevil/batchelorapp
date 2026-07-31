/**
 * Elaine executor for the `remove_wishlist_item` action, extracted from
 * elaine/index.ts so it can be unit-tested in isolation without importing the
 * full 9 800-line router module.
 *
 * See TRAVEL_ACTION_EXECUTORS in elaine/index.ts for the canonical wiring.
 */
import { eq } from "drizzle-orm";
import { db, travelsWishlist } from "@workspace/db";

export async function removeWishlistItemExecutor(
  wishlistId: number,
): Promise<{ status: number; body: unknown }> {
  const [existing] = await db
    .select({ id: travelsWishlist.id })
    .from(travelsWishlist)
    .where(eq(travelsWishlist.id, wishlistId));
  if (!existing)
    return { status: 404, body: { error: "Wishlist item not found" } };
  await db.delete(travelsWishlist).where(eq(travelsWishlist.id, wishlistId));
  return {
    status: 200,
    body: { type: "remove_wishlist_item", result: { id: wishlistId } },
  };
}
