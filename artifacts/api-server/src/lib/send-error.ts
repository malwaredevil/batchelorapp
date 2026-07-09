/**
 * Centralised helper for sending consistent JSON error responses.
 * All routes should use this instead of inline res.status().json({error:...})
 * so the shape stays uniform across the whole API and can be changed once.
 *
 * Shape: { error: string }
 */
import type { Response } from "express";

export function sendError(
  res: Response,
  status: number,
  message: string,
): void {
  res.status(status).json({ error: message });
}
