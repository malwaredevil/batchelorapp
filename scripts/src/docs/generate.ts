import fs from "node:fs";
import path from "node:path";
import { format } from "prettier";
import {
  GENERATED_DIR,
  ROOT,
  generatedHeader,
  listFiles,
  readJson,
  readYaml,
  writeGenerated,
} from "./utils";

type PackageJson = {
  name: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type OpenApi = {
  paths?: Record<
    string,
    Record<string, { operationId?: string; tags?: string[] }>
  >;
};

function normalizePathForDocs(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function generateDependencies(): void {
  const packages = listFiles(ROOT, (file) => file.endsWith("package.json"))
    .filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`))
    .map((file) => ({
      relative: normalizePathForDocs(path.relative(ROOT, file)),
      pkg: JSON.parse(fs.readFileSync(file, "utf8")) as PackageJson,
    }));
  const rows = packages.map(({ relative, pkg }) => {
    const deps = Object.keys(pkg.dependencies ?? {}).length;
    const devDeps = Object.keys(pkg.devDependencies ?? {}).length;
    return `| ${pkg.name} | ${relative} | ${pkg.version ?? "private"} | ${deps} | ${devDeps} |`;
  });
  writeGenerated(
    "dependencies.md",
    `${generatedHeader("Generated dependency reference")}\n| Package | Manifest | Version | Runtime deps | Dev deps |\n|---|---:|---:|---:|---:|\n${rows.join("\n")}`,
  );
}

function generateRoutes(): void {
  const spec = readYaml("lib/api-spec/openapi.yaml") as OpenApi;
  const rows: string[] = [];
  for (const [route, item] of Object.entries(spec.paths ?? {}).sort()) {
    for (const [method, op] of Object.entries(item).sort()) {
      rows.push(
        `| ${method.toUpperCase()} | /api${route} | ${op.operationId ?? ""} | ${(op.tags ?? []).join(", ")} |`,
      );
    }
  }
  writeGenerated(
    "routes.md",
    `${generatedHeader("Generated route reference")}\n| Method | Path | Operation ID | Tags |\n|---|---|---|---|\n${rows.join("\n")}`,
  );
}

function generateJobs(): void {
  const registry = fs.readFileSync(
    path.join(
      ROOT,
      "artifacts",
      "api-server",
      "src",
      "lib",
      "jobs",
      "registry.ts",
    ),
    "utf8",
  );
  const types = Array.from(registry.matchAll(/type: "([^"]+)"/g)).map(
    (m) => m[1],
  );
  writeGenerated(
    "jobs.md",
    `${generatedHeader("Generated job and scheduler reference")}\n| Job type |\n|---|\n${types.map((type) => `| ${type} |`).join("\n")}`,
  );
}

function generateProviders(): void {
  const providers = [
    ["OpenRouter", "OPENROUTER_API_KEY", "AI gateway"],
    ["Jina", "JINA_API_KEY", "Embeddings/reader"],
    ["Voyage", "VOYAGE_API_KEY", "Reranking"],
    ["Apify", "APIFY_API_TOKEN", "Actor runs"],
    ["Resend", "RESEND_API_KEY", "Email"],
    ["AgentPhone", "AGENTPHONE_API_KEY", "SMS/voice"],
    [
      "Google",
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET",
      "OAuth/Gmail/Calendar",
    ],
    ["Supabase", "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY", "Storage"],
  ];
  writeGenerated(
    "providers.md",
    `${generatedHeader("Generated external provider reference")}\n| Provider | Env names only | Capabilities |\n|---|---|---|\n${providers.map((row) => `| ${row.join(" | ")} |`).join("\n")}`,
  );
}

function generateStorage(): void {
  writeGenerated(
    "storage.md",
    `${generatedHeader("Generated storage reference")}\n| Bucket | Access mode | Notes |\n|---|---|---|\n| pottery | private | API signs/proxies household pottery images. |\n| quilting | private | API signs/proxies fabric and pattern images. |\n| ornaments | private | API signs/proxies ornament evidence/images. |\n| travels | private | API signs/proxies travel documents/photos. |`,
  );
}

function generateModelSlots(): void {
  writeGenerated(
    "model-slots.md",
    `${generatedHeader("Generated AI model slot reference")}\n| Slot | Gateway | Notes |\n|---|---|---|\n| Elaine chat | OpenRouter | Defaults live in api-server config/app_config. |\n| Vision analysis | OpenRouter/Jina | OpenRouter vision and Jina CLIP embeddings. |\n| Reranking | Voyage | Voyage rerank calls for compare/search. |\n| Embeddings | Jina/vector | 1536-dimension pgvector fields where configured. |`,
  );
}

function generateSchema(): void {
  const inventoryPath = path.join(
    GENERATED_DIR,
    "database-security-inventory.json",
  );
  const inventory = fs.existsSync(inventoryPath)
    ? readJson<Record<string, unknown>>(
        "docs/generated/database-security-inventory.json",
      )
    : {};
  writeGenerated(
    "schema.md",
    `${generatedHeader("Generated schema/security reference")}\n\`\`\`json\n${JSON.stringify(inventory, null, 2)}\n\`\`\``,
  );
}

generateDependencies();
generateRoutes();
generateJobs();
generateProviders();
generateStorage();
generateModelSlots();
generateSchema();

for (const file of fs.readdirSync(GENERATED_DIR)) {
  if (!file.endsWith(".md")) continue;
  const full = path.join(GENERATED_DIR, file);
  fs.writeFileSync(
    full,
    await format(fs.readFileSync(full, "utf8"), {
      parser: "markdown",
    }),
  );
}

console.log(`Generated docs in ${path.relative(ROOT, GENERATED_DIR)}`);
