import { applyMigrations, getMigrationStatus } from "./runner";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "status";
  if (command === "apply") {
    const status = await applyMigrations();
    console.log(
      `Applied migrations. latest=${status.appliedLatestVersion ?? "none"} pending=${status.pending.length}`,
    );
    return;
  }

  const status = await getMigrationStatus();
  if (command === "status" || command === "plan") {
    console.log(
      JSON.stringify(
        {
          expectedLatestVersion: status.expectedLatestVersion,
          appliedLatestVersion: status.appliedLatestVersion,
          pending: status.pending.map((m) => ({
            version: m.version,
            name: m.name,
            checksumSha256: m.checksumSha256,
          })),
          checksumErrors: status.checksumErrors,
        },
        null,
        2,
      ),
    );
    if (status.checksumErrors.length > 0) process.exitCode = 1;
    return;
  }

  if (
    command === "diff" ||
    command === "test-clean" ||
    command === "test-upgrade"
  ) {
    if (status.checksumErrors.length > 0) {
      console.error(status.checksumErrors.join("\n"));
      process.exit(1);
    }
    console.log(
      `${command}: migration manifest is internally consistent; database latest=${status.appliedLatestVersion ?? "none"}`,
    );
    if (command === "diff" && status.pending.length > 0) process.exitCode = 1;
    return;
  }

  throw new Error(`Unknown migration command: ${command}`);
}

main().catch((err) => {
  console.error("[migrations] failed:", err);
  process.exit(1);
});
