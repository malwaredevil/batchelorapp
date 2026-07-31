import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const SHELL_ADAPTERS = [
  "artifacts/web/src/components/AppLauncher.tsx",
  "artifacts/modules/src/components/module-shell.tsx",
  "artifacts/elaine/src/components/Header.tsx",
];

const AUTH_ROOTS = [
  "artifacts/web/src/App.tsx",
  "artifacts/modules/src/App.tsx",
  "artifacts/elaine/src/App.tsx",
];

const ARTIFACT_STYLES = [
  "artifacts/web/src/index.css",
  "artifacts/modules/src/index.css",
  "artifacts/elaine/src/index.css",
];

const violations: string[] = [];

function source(path: string) {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

for (const path of SHELL_ADAPTERS) {
  const contents = source(path);
  if (!contents.includes("ApplicationHeader")) {
    violations.push(
      `${path}: must compose @workspace/app-shell ApplicationHeader`,
    );
  }
  if (/<header(?:\s|>)/.test(contents)) {
    violations.push(`${path}: must not implement a separate global <header>`);
  }
  for (const ownedText of ["Owner Panel", "Account settings", "Sign out"]) {
    if (contents.includes(ownedText)) {
      violations.push(
        `${path}: "${ownedText}" belongs to the shared AccountMenu`,
      );
    }
  }
}

for (const path of AUTH_ROOTS) {
  const contents = source(path);
  if (contents.includes("WebCoreAuthProvider")) {
    violations.push(`${path}: redundant nested auth provider detected`);
  }
  const providerCount = contents.match(/<AuthProvider(?:\s|>)/g)?.length ?? 0;
  if (providerCount !== 1) {
    violations.push(
      `${path}: expected exactly one authoritative AuthProvider, found ${providerCount}`,
    );
  }
  if (!contents.includes("ThemePreferenceSync")) {
    violations.push(`${path}: must apply shared ThemePreferenceSync`);
  }
}

for (const path of ARTIFACT_STYLES) {
  if (!source(path).includes('@source "../../../lib/app-shell/src"')) {
    violations.push(
      `${path}: Tailwind must scan shared app-shell component classes`,
    );
  }
}

const sharedHeader = source("lib/app-shell/src/application-header.tsx");
for (const requiredText of ["Owner Panel", "Account settings", "Sign out"]) {
  if (!sharedHeader.includes(requiredText)) {
    violations.push(
      `lib/app-shell/src/application-header.tsx: missing shared "${requiredText}" behavior`,
    );
  }
}

if (violations.length > 0) {
  console.error(
    "\n✖ Shared application-shell drift detected. Global app chrome must be extended through @workspace/app-shell.\n",
  );
  violations.forEach((violation) => console.error(`  ${violation}`));
  process.exit(1);
}

console.log(
  `✓ Shared application shell adopted by ${SHELL_ADAPTERS.length} SPA adapters, ${AUTH_ROOTS.length} auth roots, and ${ARTIFACT_STYLES.length} style roots.`,
);
console.log(
  `  Contract: ${relative(REPO_ROOT, join(REPO_ROOT, "lib/app-shell/src/application-header.tsx"))}`,
);
