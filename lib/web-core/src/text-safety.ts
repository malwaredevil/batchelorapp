/**
 * Strip selected tag blocks in one forward pass. Unlike a lazy wildcard regex,
 * repeated opening tags without a closing tag cannot trigger quadratic scans.
 * This is text cleanup, not an HTML renderer or a prompt-injection boundary.
 */
export function stripTextMarkup(
  text: string,
  options: {
    hiddenTags: readonly string[];
    replacement: string;
    stripOtherTags?: boolean;
    /** Preserve bare diagnostic fragments when no closing tag was present. */
    preserveUnclosed?: boolean;
  },
): string {
  const hidden = new Set(options.hiddenTags.map((tag) => tag.toLowerCase()));
  const output: string[] = [];
  let depth = 0;
  let visibleFrom = 0;
  let tokenStart = -1;
  let hiddenStart = -1;
  let sawClosing = false;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "<") {
      tokenStart = i;
      continue;
    }
    if (text[i] !== ">" || tokenStart < 0) continue;

    let nameStart = tokenStart + 1;
    const closing = text[nameStart] === "/";
    if (closing) nameStart++;
    let nameEnd = nameStart;
    while (nameEnd < i) {
      const code = text.charCodeAt(nameEnd);
      if (
        !(
          (code >= 65 && code <= 90) ||
          (code >= 97 && code <= 122) ||
          (code >= 48 && code <= 57)
        )
      )
        break;
      nameEnd++;
    }
    const name = text.slice(nameStart, nameEnd).toLowerCase();
    const boundary = nameEnd === i || /[\t\n\f\r /]/.test(text[nameEnd] ?? "");
    if (boundary && hidden.has(name)) {
      if (!closing) {
        if (depth === 0) {
          output.push(text.slice(visibleFrom, tokenStart), options.replacement);
          hiddenStart = tokenStart;
          sawClosing = false;
        }
        depth++;
      } else if (depth > 0) {
        sawClosing = true;
        depth--;
        if (depth === 0) visibleFrom = i + 1;
      }
    } else if (depth === 0 && options.stripOtherTags) {
      output.push(text.slice(visibleFrom, tokenStart), " ");
      visibleFrom = i + 1;
    }
    tokenStart = -1;
  }
  if (depth === 0) output.push(text.slice(visibleFrom));
  else if (options.preserveUnclosed && !sawClosing) {
    // Runtime error diagnostics historically retain a bare "<think>" fragment.
    // Keep that explicit policy without rescanning every unmatched opening.
    output.pop();
    output.push(text.slice(hiddenStart));
  }
  return output.join("");
}
