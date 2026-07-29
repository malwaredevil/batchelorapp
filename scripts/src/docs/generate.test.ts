import assert from "node:assert/strict";
import path from "node:path";
import { isWorkspaceManifest, OPENAPI_HTTP_METHODS } from "./generate";

const root = process.cwd();
assert.equal(isWorkspaceManifest(path.join(root, "package.json")), true);
assert.equal(
  isWorkspaceManifest(
    path.join(root, "artifacts", "api-server", "package.json"),
  ),
  true,
);
assert.equal(
  isWorkspaceManifest(path.join(root, ".local", "skills", "x", "package.json")),
  false,
);
assert.equal(
  isWorkspaceManifest(path.join(root, ".cache", "typescript", "package.json")),
  false,
);
assert.equal(
  isWorkspaceManifest(path.join(root, "node_modules", "x", "package.json")),
  false,
);
assert.equal(OPENAPI_HTTP_METHODS.has("get"), true);
assert.equal(OPENAPI_HTTP_METHODS.has("parameters"), false);
console.log("docs generator scope tests passed");
