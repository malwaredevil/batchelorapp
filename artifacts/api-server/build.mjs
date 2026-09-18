import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, cp, rename, readdir, open, stat } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const BUILD_LOCK_TIMEOUT_MS = 60_000;

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

async function acquireBuildLock(lockPath) {
  const lockProcess = spawn(
    "flock",
    [
      "-x",
      "-w",
      String(BUILD_LOCK_TIMEOUT_MS / 1000),
      lockPath,
      "sh",
      "-c",
      "echo READY; cat >/dev/null",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "";
  lockProcess.stderr.setEncoding("utf8");
  lockProcess.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve, reject) => {
    lockProcess.once("error", reject);
    lockProcess.once("close", (code, signal) => resolve({ code, signal }));
  });
  exited.catch(() => {});
  await new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let timeout;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    timeout = setTimeout(() => {
      lockProcess.kill("SIGTERM");
      settle(
        reject,
        new Error(`Timed out waiting for API build lock ${lockPath}`),
      );
    }, BUILD_LOCK_TIMEOUT_MS + 1_000);
    lockProcess.stdout.setEncoding("utf8");
    lockProcess.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("READY\n")) settle(resolve);
    });
    exited.then(
      (result) => {
        if (result.code !== 0 || result.signal) {
          settle(
            reject,
            new Error(
              `Failed to acquire API build lock ${lockPath}: ${stderr.trim() || `exit ${result.code ?? result.signal}`}`,
            ),
          );
        } else if (!settled) {
          settle(
            reject,
            new Error(
              `API build lock exited before becoming ready: ${lockPath}`,
            ),
          );
        }
      },
      (error) => {
        settle(reject, error);
      },
    );
  });
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    lockProcess.stdin.end();
    const result = await exited;
    if (result.code !== 0 || result.signal) {
      throw new Error(
        `API build lock exited unsuccessfully: ${stderr.trim() || `exit ${result.code ?? result.signal}`}`,
      );
    }
  };
}
async function rewriteStagedRuntimePaths(directory, stagingDir, distDir) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteStagedRuntimePaths(entryPath, stagingDir, distDir);
      continue;
    }
    if (!entry.name.endsWith(".mjs")) continue;

    const handle = await open(entryPath, "r+");
    try {
      const content = await handle.readFile("utf8");
      if (!content.includes(stagingDir)) continue;

      const rewritten = content.replaceAll(stagingDir, distDir);
      if (rewritten.includes(stagingDir)) {
        throw new Error(`Staging path remained in generated file ${entryPath}`);
      }
      await handle.truncate(0);
      await handle.write(rewritten, 0, "utf8");
    } finally {
      await handle.close();
    }
  }
}

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  const stagingDir = path.resolve(artifactDir, `.dist-staging-${process.pid}`);
  const previousDir = path.resolve(artifactDir, ".dist-previous");
  const releaseBuildLock = await acquireBuildLock(
    path.resolve(artifactDir, ".dist-build.lock"),
  );

  try {
    await rm(stagingDir, { recursive: true, force: true });
    if (await pathExists(previousDir)) {
      if (await pathExists(distDir)) {
        await rm(previousDir, { recursive: true, force: true });
      } else {
        await rename(previousDir, distDir);
      }
    }

    await esbuild({
      entryPoints: [
        path.resolve(artifactDir, "src/instrument.ts"),
        path.resolve(artifactDir, "src/index.ts"),
        path.resolve(artifactDir, "src/scripts/send-reminder-alerts.ts"),
      ],
      platform: "node",
      bundle: true,
      format: "esm",
      outdir: stagingDir,
      outExtension: { ".js": ".mjs" },
      logLevel: "info",
      // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
      // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
      // Examples of unbundleable packages:
      // - uses native modules and loads them dynamically (e.g. sharp)
      // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
      external: [
        "*.node",
        // @sentry/node is externalized so that instrument.mjs (loaded via
        // --import before the main bundle) and the main bundle share one SDK
        // instance. @sentry/node resolves its own @opentelemetry/* peers via
        // pnpm's virtual store, so those no longer need to be bundled here.
        "@sentry/node",
        // openai must be externalized so that @sentry/node's openAIIntegration()
        // can instrument it at runtime via OpenTelemetry module patching.
        // When bundled inline, OTel can't find the module to hook into.
        "openai",
        "sharp",
        "@neplex/vectorizer",
        "@neplex/vectorizer-*",
        "better-sqlite3",
        "sqlite3",
        "canvas",
        "bcrypt",
        "argon2",
        "fsevents",
        "re2",
        "farmhash",
        "xxhash-addon",
        "bufferutil",
        "utf-8-validate",
        "ssh2",
        "cpu-features",
        "dtrace-provider",
        "isolated-vm",
        "lightningcss",
        "pg-native",
        "oracledb",
        "mongodb-client-encryption",
        "nodemailer",
        "handlebars",
        "knex",
        "typeorm",
        "protobufjs",
        "onnxruntime-node",
        "@tensorflow/*",
        "@prisma/client",
        "@mikro-orm/*",
        "@grpc/*",
        "@swc/*",
        // pdfkit (and its transitive deps fontkit/brotli/png-js) load font/data
        // files via paths relative to their own package directory at runtime.
        // Bundling flattens that directory structure and breaks resolution
        // (e.g. "ENOENT ... dist/data/Helvetica.afm"), so keep it external and
        // let it resolve from node_modules like the other asset-loading libs.
        "pdfkit",
        "@aws-sdk/*",
        "@azure/*",
        "@google-cloud/*",
        "@google/*",
        "googleapis",
        "firebase-admin",
        "@parcel/watcher",
        "@sentry/profiling-node",
        "@tree-sitter/*",
        "aws-sdk",
        "classic-level",
        "dd-trace",
        "ffi-napi",
        "grpc",
        "hiredis",
        "kerberos",
        "leveldown",
        "miniflare",
        "mysql2",
        "newrelic",
        "odbc",
        "piscina",
        "realm",
        "ref-napi",
        "rocksdb",
        "sass-embedded",
        "sequelize",
        "serialport",
        "snappy",
        "tinypool",
        "usb",
        "workerd",
        "wrangler",
        "zeromq",
        "zeromq-prebuilt",
        "playwright",
        "puppeteer",
        "puppeteer-core",
        "electron",
      ],
      // Substitute process.env.NODE_ENV at bundle time so esbuild can
      // dead-code-eliminate dev-only branches (e.g. the screenshot-login router)
      // when NODE_ENV=production is set in the build environment.
      define: {
        "process.env.NODE_ENV": JSON.stringify(
          process.env.NODE_ENV ?? "development",
        ),
      },
      sourcemap: "linked",
      plugins: [
        // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
        esbuildPluginPino({ transports: ["pino-pretty"] }),
      ],
      // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
      banner: {
        js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
      },
    });

    await cp(
      path.resolve(artifactDir, "src/dev-assets"),
      path.resolve(stagingDir, "dev-assets"),
      { recursive: true },
    );
    await rewriteStagedRuntimePaths(stagingDir, stagingDir, distDir);

    let previousDistExists = false;
    try {
      await rename(distDir, previousDir);
      previousDistExists = true;
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }

    try {
      await rename(stagingDir, distDir);
    } catch (err) {
      if (previousDistExists) {
        try {
          await rename(previousDir, distDir);
        } catch (restoreErr) {
          throw new AggregateError(
            [err, restoreErr],
            `API build promotion and rollback both failed; recovery artifact preserved at ${previousDir}`,
          );
        }
      }
      throw err;
    }

    if (previousDistExists) {
      await rm(previousDir, { recursive: true, force: true });
    }
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
    await releaseBuildLock();
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
