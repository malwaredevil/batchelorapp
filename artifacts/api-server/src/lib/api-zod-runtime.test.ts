import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ForgotPasswordResponse,
  HealthCheckResponse,
} from "@workspace/api-zod";

const buildSourcePath = fileURLToPath(
  new URL("../../build.mjs", import.meta.url),
);

let fixtureDir: string;
let fixtureBuildPath: string;

async function exists(targetPath: string) {
  try {
    await readFile(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EISDIR") return true;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function waitFor(
  predicate: () => Promise<boolean>,
  description: string,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function resetFixture() {
  const entries = await readdir(fixtureDir);
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry === "dist" ||
          entry === ".dist-previous" ||
          entry === ".dist-build.lock" ||
          entry.startsWith(".dist-staging-"),
      )
      .map((entry) => rm(path.join(fixtureDir, entry), { recursive: true })),
  );
}

function buildEnvironment(extra: NodeJS.ProcessEnv = {}) {
  return {
    ...process.env,
    NODE_ENV: "production",
    ...extra,
  };
}

function startBuild(extraEnv: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [fixtureBuildPath], {
    cwd: fixtureDir,
    env: buildEnvironment(extraEnv),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.resume();
  child.stderr?.resume();
  return child;
}

function waitForChild(child: ReturnType<typeof spawn>) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve({ code: child.exitCode, signal: child.signalCode });
        return;
      }
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
}

async function runtimeBundles() {
  const bundles: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.name.endsWith(".mjs")) {
        bundles.push(entryPath);
      }
    }
  }
  await visit(path.join(fixtureDir, "dist"));
  return bundles;
}

async function fixtureHasRunnableArtifact() {
  return (
    (await exists(path.join(fixtureDir, "dist", "index.mjs"))) &&
    (await exists(path.join(fixtureDir, "dist", "instrument.mjs")))
  );
}

beforeAll(async () => {
  fixtureDir = await mkdtemp(path.join(os.tmpdir(), "api-build-regression-"));
  fixtureBuildPath = path.join(fixtureDir, "build.mjs");

  const buildSource = await readFile(buildSourcePath, "utf8");
  const fixtureBuildSource = buildSource.replace(
    "echo READY; cat >/dev/null",
    `if [ \\"\${API_BUILD_TEST_SPLIT_READY:-0}\\" = \\"1\\" ]; then printf READY; sleep 0.05; printf '\\n'; else echo READY; fi; cat >/dev/null`,
  );
  const promotionMarker = "    try {\n      await rename(stagingDir, distDir);";
  if (!fixtureBuildSource.includes(promotionMarker)) {
    throw new Error("API build promotion marker changed; update this test");
  }
  const interruptedBuildSource = fixtureBuildSource.replace(
    promotionMarker,
    `    if (process.env.API_BUILD_TEST_INTERRUPT === "1") {
      await rm(stagingDir, { recursive: true, force: true });
    }

${promotionMarker}`,
  );
  await writeFile(fixtureBuildPath, interruptedBuildSource);
  await symlink(
    path.resolve(path.dirname(buildSourcePath), "node_modules"),
    path.join(fixtureDir, "node_modules"),
    "dir",
  );
  await mkdir(path.join(fixtureDir, "src", "dev-assets"), {
    recursive: true,
  });
  await mkdir(path.join(fixtureDir, "src", "scripts"), { recursive: true });
  await writeFile(
    path.join(fixtureDir, "src", "instrument.ts"),
    `import pino from "pino";
export const logger = pino({ level: "silent" });
`,
  );
  await writeFile(
    path.join(fixtureDir, "src", "index.ts"),
    `import { logger } from "./instrument";
logger.info("fixture");
`,
  );
  await writeFile(
    path.join(fixtureDir, "src", "scripts", "send-reminder-alerts.ts"),
    `import { logger } from "../instrument";
logger.info("fixture reminder");
`,
  );
  await writeFile(
    path.join(fixtureDir, "src", "dev-assets", "fixture.txt"),
    "fixture asset",
  );
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("@workspace/api-zod runtime compatibility", () => {
  it("evaluates normal and no-content schemas under the installed Zod version", () => {
    expect(HealthCheckResponse.safeParse({ status: "ok" }).success).toBe(true);
    expect(ForgotPasswordResponse.safeParse(undefined).success).toBe(true);
  });
});

describe("API build publication safety", () => {
  it("releases the lock when its owner is killed", async () => {
    await resetFixture();
    const firstBuild = startBuild();
    await waitFor(
      () => exists(path.join(fixtureDir, `.dist-staging-${firstBuild.pid}`)),
      "first build to start",
    );
    process.kill(firstBuild.pid!, "SIGKILL");
    await waitForChild(firstBuild);

    await expect(waitForChild(startBuild())).resolves.toMatchObject({
      code: 0,
    });
    await expect(fixtureHasRunnableArtifact()).resolves.toBe(true);
  });

  it("serializes concurrent builds while the first owner is stopped", async () => {
    await resetFixture();
    const firstBuild = startBuild();
    const lockPath = path.join(fixtureDir, ".dist-build.lock");

    await waitFor(async () => exists(lockPath), "first build to own the lock");
    process.kill(firstBuild.pid!, "SIGSTOP");

    const secondBuild = startBuild();
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(secondBuild.exitCode).toBeNull();
    } finally {
      if (firstBuild.exitCode === null) {
        process.kill(firstBuild.pid!, "SIGCONT");
      }
    }
    await expect(waitForChild(firstBuild)).resolves.toMatchObject({ code: 0 });
    await expect(waitForChild(secondBuild)).resolves.toMatchObject({ code: 0 });
    await expect(fixtureHasRunnableArtifact()).resolves.toBe(true);
  });

  it("restores the previous runnable artifact when promotion is interrupted", async () => {
    await resetFixture();
    await expect(waitForChild(startBuild())).resolves.toMatchObject({
      code: 0,
    });
    const priorArtifact = path.join(fixtureDir, "dist", "prior-runnable.txt");
    await writeFile(priorArtifact, "keep this artifact");

    const interruptedBuild = startBuild({ API_BUILD_TEST_INTERRUPT: "1" });
    await expect(waitForChild(interruptedBuild)).resolves.toMatchObject({
      code: 1,
    });

    await expect(readFile(priorArtifact, "utf8")).resolves.toBe(
      "keep this artifact",
    );
    await expect(fixtureHasRunnableArtifact()).resolves.toBe(true);
    await expect(exists(path.join(fixtureDir, ".dist-previous"))).resolves.toBe(
      false,
    );
  });

  it("rewrites generated runtime bundles from staging paths to final dist paths", async () => {
    await resetFixture();
    await expect(waitForChild(startBuild())).resolves.toMatchObject({
      code: 0,
    });

    const bundles = await runtimeBundles();
    expect(bundles.some((bundle) => bundle.endsWith("pino-worker.mjs"))).toBe(
      true,
    );
    for (const bundle of bundles) {
      const content = await readFile(bundle, "utf8");
      expect(content).not.toContain(".dist-staging-");
      expect(content).not.toMatch(/^\0/);
      if (content.includes("pinoBundlerAbsolutePath")) {
        expect(content).toContain(path.join(fixtureDir, "dist"));
      }
    }
  });

  it("handles lock readiness split across stdout chunks", async () => {
    await resetFixture();
    await expect(
      waitForChild(startBuild({ API_BUILD_TEST_SPLIT_READY: "1" })),
    ).resolves.toMatchObject({ code: 0 });
    await expect(fixtureHasRunnableArtifact()).resolves.toBe(true);
  });
});
