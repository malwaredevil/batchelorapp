import assert from "node:assert/strict";
import { inspectWorkflow, inspectActionFile } from "./check-workflow-security.js";

const safe = `
name: Safe
on: pull_request
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          persist-credentials: false
      - run: echo safe
`;

assert.deepEqual(inspectWorkflow(safe), []);

const floatingAction = safe.replace(
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/checkout@v7",
);
assert.match(
  inspectWorkflow(floatingAction).join("\n"),
  /full 40-character SHA/,
);

const missingTimeout = safe.replace("    timeout-minutes: 10\n", "");
assert.match(inspectWorkflow(missingTimeout).join("\n"), /timeout-minutes/);

const persistedToken = safe.replace(
  "persist-credentials: false",
  "persist-credentials: true",
);
assert.match(inspectWorkflow(persistedToken).join("\n"), /persist-credentials/);

const privilegedCheckout = safe.replace(
  "on: pull_request",
  "on: pull_request_target",
);
assert.match(
  inspectWorkflow(privilegedCheckout).join("\n"),
  /may not check out/,
);

const mappedPrivilegedCheckout = safe.replace(
  "on: pull_request",
  "on:\n  pull_request_target:",
);
assert.match(
  inspectWorkflow(mappedPrivilegedCheckout).join("\n"),
  /may not check out/,
);

const inheritedSecrets = safe.replace(
  "    runs-on: ubuntu-latest",
  "    uses: owner/repo/.github/workflows/reusable.yml@3d3c42e5aac5ba805825da76410c181273ba90b1\n    secrets: inherit",
);
assert.match(inspectWorkflow(inheritedSecrets).join("\n"), /secrets: inherit/);

// --- composite action files ---
const safeAction = `
name: Setup workspace
runs:
  using: composite
  steps:
    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
      with:
        persist-credentials: false
    - run: echo hi
      shell: bash
`;
assert.deepEqual(inspectActionFile(safeAction, "action.yml"), []);

const floatingActionRef = safeAction.replace(
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/checkout@v7",
);
assert.match(
  inspectActionFile(floatingActionRef, "action.yml").join("\n"),
  /full 40-character SHA/,
);

const unpersistedAction = safeAction.replace(
  "persist-credentials: false",
  "persist-credentials: true",
);
assert.match(
  inspectActionFile(unpersistedAction, "action.yml").join("\n"),
  /persist-credentials/,
);

// A local composite-action reference (./...) is exempt from SHA pinning.
const localRefAction = safeAction.replace(
  "- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n      with:\n        persist-credentials: false",
  "- uses: ./.github/actions/other-action",
);
assert.deepEqual(inspectActionFile(localRefAction, "action.yml"), []);

console.log("✓ workflow security checker tests passed");
