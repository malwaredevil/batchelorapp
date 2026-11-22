import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const elaineRequire = createRequire(
  new URL("../../artifacts/elaine/package.json", import.meta.url),
);
const typographyRequire = createRequire(
  elaineRequire.resolve("@tailwindcss/typography"),
);
const apiRequire = createRequire(
  new URL("../../artifacts/api-server/package.json", import.meta.url),
);
const pwaRequire = createRequire(elaineRequire.resolve("vite-plugin-pwa"));
const workboxRequire = createRequire(pwaRequire.resolve("workbox-build"));

test("patched qs preserves normal encoding and safely handles hostile comma values", () => {
  const expressRequire = createRequire(apiRequire.resolve("express"));
  const qs = expressRequire("qs");
  assert.equal(expressRequire("qs/package.json").version, "6.17.1");
  assert.equal(
    qs.stringify({ a: ["x", "y"] }, { arrayFormat: "comma" }),
    "a=x%2Cy",
  );
  for (const options of [
    { arrayFormat: "comma" },
    { arrayFormat: "comma", encodeValuesOnly: true },
  ]) {
    assert.doesNotThrow(() =>
      qs.stringify(JSON.parse('{"a":[{"toString":"x"}]}'), options),
    );
  }
});

test("patched XML parser still reads feed data and rejects unfinished stop nodes", () => {
  const { XMLParser } = apiRequire("fast-xml-parser");
  assert.deepEqual(new XMLParser().parse("<feed><title>Trip</title></feed>"), {
    feed: { title: "Trip" },
  });
  const stopParser = new XMLParser({ stopNodes: ["stop"] });
  assert.throws(() => stopParser.parse(`<stop>${"<a ".repeat(50)}`));
});

test("Workbox builds a real precache manifest with patched glob and minimatch", async () => {
  const globRequire = createRequire(workboxRequire.resolve("glob"));
  assert.equal(workboxRequire("glob/package.json").version, "14.0.6");
  assert.equal(globRequire("minimatch/package.json").version, "11.0.9");
  const directory = mkdtempSync(join(tmpdir(), "batchelor-precache-"));
  try {
    mkdirSync(join(directory, "nested"));
    for (const file of [
      "entry.js",
      "theme.css",
      "nested/chunk.js",
      "ignored.js",
      "notes.txt",
    ]) {
      writeFileSync(join(directory, file), `fixture ${file}`);
    }
    const { getManifest } = pwaRequire("workbox-build");
    const result = await getManifest({
      globDirectory: directory,
      globPatterns: ["**/*.{js,css}"],
      globIgnores: ["**/ignored.js"],
    });
    assert.deepEqual(result.warnings, []);
    assert.equal(result.count, 3);
    assert.deepEqual(
      result.manifestEntries.map((entry: { url: string }) => entry.url).sort(),
      ["entry.js", "nested/chunk.js", "theme.css"],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("FileList retains include/exclude behavior with patched minimatch", () => {
  const rollupRequire = createRequire(
    workboxRequire.resolve("@trickfilm400/rollup-plugin-off-main-thread"),
  );
  const ejsRequire = createRequire(rollupRequire.resolve("ejs"));
  const jakeRequire = createRequire(ejsRequire.resolve("jake"));
  const filelistRequire = createRequire(jakeRequire.resolve("filelist"));
  assert.equal(filelistRequire("minimatch/package.json").version, "11.0.9");
  const { FileList } = jakeRequire("filelist");
  const directory = mkdtempSync(join(tmpdir(), "batchelor-filelist-"));
  try {
    for (const file of ["alpha.js", "beta.js", "gamma.js"]) {
      writeFileSync(join(directory, file), "fixture");
    }
    const files = new FileList();
    files.include(join(directory, "*.js"));
    files.exclude(join(directory, "beta.*"));
    assert.deepEqual(files.toArray().sort(), [
      join(directory, "alpha.js"),
      join(directory, "gamma.js"),
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("every Zod consumer uses the patched major and compatible entry points", () => {
  for (const workspace of [
    "artifacts/api-server",
    "artifacts/web",
    "artifacts/modules",
    "artifacts/elaine",
    "artifacts/mockup-sandbox",
    "lib/api-zod",
    "lib/db",
  ]) {
    const localRequire = createRequire(
      new URL(`../../${workspace}/package.json`, import.meta.url),
    );
    assert.equal(localRequire("zod/package.json").version, "4.6.6", workspace);
    const { z } = localRequire("zod");
    const { z: explicitV4 } = localRequire("zod/v4");
    const nested = z.object({
      metadata: explicitV4.record(explicitV4.string(), explicitV4.unknown()),
    });
    assert.deepEqual(nested.parse({ metadata: { note: "ok" } }), {
      metadata: { note: "ok" },
    });
  }
});

test("real form resolvers return field errors rather than throwing Zod 4 failures", async () => {
  for (const app of ["web", "modules", "elaine", "mockup-sandbox"]) {
    const localRequire = createRequire(
      new URL(`../../artifacts/${app}/package.json`, import.meta.url),
    );
    const { z } = localRequire("zod");
    const { zodResolver } = localRequire("@hookform/resolvers/zod");
    const schema = z.object({
      quantity: z.coerce.number().int().min(1).default(1),
    });
    const resolve = zodResolver(schema);
    const options = { fields: {}, shouldUseNativeValidation: false };
    const invalid = await resolve({ quantity: 0 }, {}, options);
    assert.equal(invalid.errors.quantity.type, "too_small", app);
    assert.match(invalid.errors.quantity.message, /1/, app);
    const valid = await resolve({ quantity: "2" }, {}, options);
    assert.deepEqual(valid, { values: { quantity: 2 }, errors: {} }, app);
    const omitted = await resolve({}, {}, options);
    assert.deepEqual(omitted, { values: { quantity: 1 }, errors: {} }, app);
  }
});

test("typography resolves the patched selector parser", () => {
  assert.equal(
    typographyRequire("postcss-selector-parser/package.json").version,
    "7.1.6",
  );
});

test("patched selector parser preserves typography variants and nested selectors", () => {
  const plugin = elaineRequire("@tailwindcss/typography")();
  const variants = new Map<string, string>();
  const components: Record<string, unknown>[] = [];
  plugin.handler({
    addVariant: (name: string, selector: string) =>
      variants.set(name, selector),
    addComponents: (styles: Record<string, unknown>[]) =>
      components.push(...styles),
    theme: (key: string) => {
      assert.equal(key, "typography");
      return plugin.config.theme.typography;
    },
    prefix: (selector: string) => selector,
  });
  assert.match(variants.get("prose-a")!, /:where\(a\)/);
  assert.match(variants.get("prose-headings")!, /h1, h2, h3, h4, h5, h6, th/);
  assert.ok(components.some((entry) => ".prose" in entry));
  assert.ok(components.some((entry) => ".prose-sm" in entry));
  assert.ok(components.some((entry) => ".prose-invert" in entry));
  const css = JSON.stringify(components);
  assert.match(css, /:where\(blockquote p:first-of-type\)/);
  assert.match(css, /::before/);
  assert.match(css, /not-prose/);
});

test("Mammoth remains library-only with its vulnerable CLI dependency pruned", () => {
  const workspace = readFileSync(
    new URL("../../pnpm-workspace.yaml", import.meta.url),
    "utf8",
  );
  assert.match(workspace, /"mammoth>argparse": "-"/);
  const apiRequire = createRequire(
    new URL("../../artifacts/api-server/package.json", import.meta.url),
  );
  assert.equal(typeof apiRequire("mammoth").extractRawText, "function");
  const manifest = apiRequire("./package.json");
  for (const command of Object.values(manifest.scripts)) {
    assert.doesNotMatch(String(command), /(?:^|\s)mammoth(?:\s|$)/);
  }
});
