import crypto from "node:crypto";

export function checksumStatements(statements: readonly string[]): string {
  return crypto
    .createHash("sha256")
    .update(statements.join("\n-- statement boundary --\n"), "utf8")
    .digest("hex");
}
