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
