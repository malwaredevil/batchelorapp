import { readYaml } from "./utils";

type OpenApi = {
  paths?: Record<string, Record<string, unknown>>;
};

const spec = readYaml("lib/api-spec/openapi.yaml") as OpenApi;
const missing = ["/jobs", "/operations/summary", "/operations/events"].filter(
  (path) => !spec.paths?.[path],
);

if (missing.length > 0) {
  console.error(
    `OpenAPI route audit failed; missing paths: ${missing.join(", ")}`,
  );
  process.exit(1);
}

console.log("OpenAPI route audit passed.");
