import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Official 3.11.0 Linux AMD64 release. Archive hash also matches GitHub's
// published asset digest; binary hash is verified after extraction and on reuse.
export const HOUNDDOG_RELEASE = {
  version: "3.11.0",
  archiveSha256:
    "84d93c6c87784c75c1ace77471ec55ea5b3b65a8127818aa1716f32f89000f10",
  binarySha256:
    "0e874119d6624c135926aabc8d62090a86136e86e46b0b7a154fa7104625f45f",
} as const;

export function verifySha256(bytes: Buffer, expected: string): void {
  if (createHash("sha256").update(bytes).digest("hex") !== expected) {
    throw new Error("HoundDog checksum mismatch; refusing to execute.");
  }
}

/** No inherited credentials, vendor configuration, or optional AI settings. */
export function scannerEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_CACHE_HOME: path.join(home, "cache"),
    TMPDIR: os.tmpdir(),
    LANG: "C.UTF-8",
  };
}

export async function ensureHounddog(root: string): Promise<string> {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("Pinned HoundDog installation supports Linux x86-64 only.");
  }
  const directory = path.join(
    root,
    ".local/tools/hounddog",
    HOUNDDOG_RELEASE.version,
  );
  const binary = path.join(directory, "hounddog");
  try {
    const bytes = fs.readFileSync(binary);
    verifySha256(bytes, HOUNDDOG_RELEASE.binarySha256);
    return binary;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = fs.mkdtempSync(path.join(directory, ".install-"));
  try {
    const url = `https://github.com/hounddogai/hounddog/releases/download/${HOUNDDOG_RELEASE.version}/hounddog-linux-amd64.tar.gz`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error("Official HoundDog download failed.");
    const archive = Buffer.from(await response.arrayBuffer());
    verifySha256(archive, HOUNDDOG_RELEASE.archiveSha256);
    const archivePath = path.join(temporary, "release.tar.gz");
    fs.writeFileSync(archivePath, archive, { mode: 0o600, flag: "wx" });
    // Extract only the fixed member, never arbitrary archive paths.
    execFileSync(
      "tar",
      ["-xzf", archivePath, "-C", temporary, "--", "hounddog"],
      {
        timeout: 30_000,
        stdio: "pipe",
      },
    );
    const extracted = path.join(temporary, "hounddog");
    verifySha256(fs.readFileSync(extracted), HOUNDDOG_RELEASE.binarySha256);
    fs.chmodSync(extracted, 0o700);
    fs.renameSync(extracted, binary);
    return binary;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export function scanDirectory(
  binary: string,
  source: string,
  report: string,
  home: string,
): void {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const config = path.join(home, "scanner-config.json");
  fs.writeFileSync(config, "{}\n", { mode: 0o600 });
  try {
    execFileSync(
      binary,
      [
        "scan",
        source,
        "--no-git",
        "--no-ai-review",
        "--no-cache",
        "--no-tips",
        "--no-color",
        "--config-path",
        config,
        "--output-format=json",
        `--output-path=${report}`,
      ],
      {
        cwd: home,
        env: scannerEnvironment(home),
        timeout: 300_000,
        stdio: "pipe",
      },
    );
    fs.chmodSync(report, 0o600);
  } catch {
    // Child output can contain source snippets. Never echo it into public CI.
    throw new Error(
      "HoundDog execution failed; no successful scan was accepted.",
    );
  }
}
