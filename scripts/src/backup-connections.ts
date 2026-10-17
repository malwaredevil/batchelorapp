/** Bound database connection attempts before a backup can write anything. */
export const BACKUP_CONNECTION_TIMEOUT_MS = 10_000;

interface BackupConnection {
  connect(): Promise<unknown>;
  end(): Promise<unknown>;
}

export async function connectBackupClients(
  source: BackupConnection,
  destination: BackupConnection,
): Promise<void> {
  try {
    console.log("Connecting to Supabase (source)...");
    await source.connect();
    console.log("Connecting to Replit DB (destination)...");
    await destination.connect();
  } catch (error) {
    await Promise.allSettled([source.end(), destination.end()]);
    throw error;
  }
}

/** PostgreSQL rolls back this transaction even if the backup process is killed. */
export async function withBackupSnapshot<T>(
  destination: { query(sql: string): Promise<unknown> },
  copy: () => Promise<T>,
): Promise<T> {
  await destination.query("BEGIN");
  try {
    const result = await copy();
    await destination.query("COMMIT");
    return result;
  } catch (error) {
    // Preserve the original failure if the connection has already closed.
    await destination.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
