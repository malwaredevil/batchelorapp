import { describe, expect, it } from "vitest";
import createDOMPurify from "dompurify";

// Notes use the HTML-only profile; wishlist and reminder descriptions use defaults.
// Exercise both with the HTML emitted by the shared TipTap editor.
describe.each([
  ["default", {}],
  ["HTML-only", { USE_PROFILES: { html: true } }],
] as const)("DOMPurify %s rich-text compatibility", (_name, config) => {
  it("preserves formatting, lists, safe links, images, and wishlist date spans", () => {
    const html =
      '<p style="text-align: center"><strong>Bold</strong> <em>Italic</em> <u>Underlined</u> <mark>Highlighted</mark><br>Next line</p>' +
      '<ul><li><p>Bullet<span class="note-date"> (Oct 23, 2026)</span></p></li></ul>' +
      "<ol><li><p>Numbered</p></li></ol>" +
      '<p><a href="https://example.com/trip">Trip</a><img src="/api/uploads/photo.png" alt="Trip photo"></p>';

    expect(createDOMPurify.sanitize(html, config)).toBe(html);
  });

  it("removes scripts, event handlers, and javascript URLs without losing text", () => {
    const html =
      '<p onclick="alert(1)">Keep <strong>this</strong></p>' +
      '<script>alert(1)</script><img src="x" onerror="alert(1)">' +
      '<a href="javascript:alert(1)">Link</a>';

    expect(createDOMPurify.sanitize(html, config)).toBe(
      '<p>Keep <strong>this</strong></p><img src="x"><a>Link</a>',
    );
  });
});

describe("DOMPurify advisory regressions", () => {
  it("scrubs split template expressions inside attached shadow roots (GHSA-cg2g-xh64-v4q7)", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(
      document.createTextNode("$"),
      document.createElement("object"),
      document.createTextNode("{alert(document.domain)}"),
    );

    createDOMPurify.sanitize(host, {
      IN_PLACE: true,
      SAFE_FOR_TEMPLATES: true,
    });

    expect(shadow.querySelector("object")).toBeNull();
    expect(shadow.textContent).not.toContain("${alert(document.domain)}");
  });

  it.each(["parent", "nextSibling"] as const)(
    "neutralizes nodes detached by a hook removing the %s (GHSA-mrv2-3pqr-j5jr)",
    (mode) => {
      // Isolate hooks from the instance used by other tests and application code.
      const purifier = createDOMPurify(window);
      const root = document.createElement("div");
      root.innerHTML =
        '<figure><img class="bad" src="a.png"><img id="evil" src="x" onerror="alert(1)"></figure><p>ok</p>';
      const evil = root.querySelector("#evil")!;
      purifier.addHook("afterSanitizeAttributes", (node) => {
        if (node.getAttribute("class") !== "bad") return;
        if (mode === "parent") node.parentElement?.remove();
        else node.nextElementSibling?.remove();
      });

      purifier.sanitize(root, { IN_PLACE: true });

      expect(root.contains(evil)).toBe(false);
      expect(evil.getAttribute("onerror")).toBeNull();
      expect(root.textContent).toBe("ok");
    },
  );
});
