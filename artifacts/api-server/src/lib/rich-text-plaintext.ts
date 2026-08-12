/**
 * Converts a rich-text reminder description (TipTap-generated HTML, see
 * issue #520) into a channel-appropriate plain-text form. Two shared,
 * regex-based transforms — deliberately not a full HTML parser, since the
 * only producer of this HTML is our own editor, which emits a small,
 * predictable tag set (p, br, strong, em, u, mark, ul/ol/li, a, img).
 *
 * Never render the raw HTML on a channel that can't interpret it (SMS,
 * voice, messenger plain-text chat) — every caller of this module exists to
 * close that gap.
 */

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const ANCHOR_RE =
  /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function extractHostname(url: string): string | null {
  try {
    // Relative/mailto/tel links have no meaningful "hostname" to speak.
    const parsed = new URL(url, "https://placeholder.invalid");
    if (parsed.hostname === "placeholder.invalid") return null;
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function stripRemainingTags(html: string): string {
  return html
    .replace(/<\/(p|li|div)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
}

function collapseWhitespace(text: string): string {
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, idx, arr) => line !== "" || (idx > 0 && arr[idx - 1] !== ""))
    .join("\n")
    .trim();
}

/**
 * Plain-text form for channels that display text as-is but can't render
 * HTML (messenger chat, plain SMS/email bodies). Keeps each link's visible
 * text with its URL in parentheses; drops images (nothing meaningful to
 * show for an inline image in a plain-text message).
 */
export function richTextToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  let text = html.replace(IMG_TAG_RE, "");
  text = text.replace(ANCHOR_RE, (_match, hrefDouble, hrefSingle, inner) => {
    const href = hrefDouble ?? hrefSingle ?? "";
    const label = stripRemainingTags(inner).replace(/\s+/g, " ").trim();
    if (!href) return label;
    return label && label !== href ? `${label} (${href})` : href;
  });
  return collapseWhitespace(stripRemainingTags(text));
}

/**
 * Speech-safe form for reading a reminder description aloud over a phone
 * call. Never speaks a raw URL — each link becomes a short mention of its
 * domain only ("there's a link to example.com in the description"), and
 * images are dropped with no mention at all, since there is nothing to
 * usefully describe about an arbitrary uploaded image over voice.
 */
export function richTextToSpeech(html: string | null | undefined): string {
  if (!html) return "";
  let text = html.replace(IMG_TAG_RE, "");
  text = text.replace(ANCHOR_RE, (_match, hrefDouble, hrefSingle) => {
    const href = hrefDouble ?? hrefSingle ?? "";
    const hostname = extractHostname(href);
    return hostname
      ? ` There's a link to ${hostname} in the description. `
      : " There's a link in the description. ";
  });
  const plain = collapseWhitespace(stripRemainingTags(text)).replace(
    /\n+/g,
    " ",
  );
  return plain.replace(/\s+/g, " ").trim();
}
