import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const elaineRequire = createRequire(
  new URL("../../artifacts/elaine/package.json", import.meta.url),
);
const typographyRequire = createRequire(
  elaineRequire.resolve("@tailwindcss/typography"),
);

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
