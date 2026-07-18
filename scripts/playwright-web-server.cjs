const { spawn } = require("node:child_process");

const port = process.argv[2] || "4173";
const command = process.platform === "win32" ? "corepack.cmd" : "corepack";
const child = spawn(
  command,
  [
    "pnpm",
    "--filter",
    "@workspace/web",
    "exec",
    "vite",
    "--config",
    "vite.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      PORT: port,
      BASE_PATH: "/",
    },
  },
);

child.on("exit", (code) => process.exit(code ?? 1));
