import { type ReactNode } from "react";

/** Lightweight markdown renderer covering the subset Elaine uses:
 *  bold, italic, inline code, headers (h1-h3), bullet lists, numbered lists,
 *  horizontal rules, pipe tables, inline images, and paragraphs. No external
 *  dependencies needed. */

type Token =
  | { kind: "h1" | "h2" | "h3"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "ordered"; text: string; n: number }
  | { kind: "hr" }
  | { kind: "blank" }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "text"; text: string };

/** Matches a GFM-style pipe table row, e.g. "| a | b |" or "a | b". */
function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const stripped = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = stripped.split("|").map((c) => c.trim());
  return cells.length > 0 ? cells : null;
}

/** Matches a table separator row, e.g. "| --- | :---: |" or "---|---". */
function isTableSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-")) return false;
  const stripped = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = stripped.split("|").map((c) => c.trim());
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c) && c !== "");
}

function tokenize(markdown: string): Token[] {
  const lines = markdown.split("\n");
  const tokens: Token[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]!;
    const trimmed = raw.trim();

    // Pipe table: a row containing "|" immediately followed by a valid
    // separator row (--- / :---: etc), then zero or more data rows.
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparatorRow(lines[i + 1]!)
    ) {
      const header = parseTableRow(trimmed);
      if (header) {
        i += 2; // skip header + separator
        const rows: string[][] = [];
        while (i < lines.length && lines[i]!.trim().includes("|")) {
          const row = parseTableRow(lines[i]!);
          if (!row) break;
          rows.push(row);
          i++;
        }
        tokens.push({ kind: "table", header, rows });
        continue;
      }
    }

    if (trimmed === "" || trimmed === "\r") {
      tokens.push({ kind: "blank" });
      i++;
      continue;
    }
    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      tokens.push({ kind: "hr" });
      i++;
      continue;
    }
    const hm = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      const level = hm[1]!.length as 1 | 2 | 3;
      tokens.push({
        kind: level === 1 ? "h1" : level === 2 ? "h2" : "h3",
        text: hm[2]!,
      });
      i++;
      continue;
    }
    const bm = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bm) {
      tokens.push({ kind: "bullet", text: bm[1]! });
      i++;
      continue;
    }
    const om = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (om) {
      tokens.push({ kind: "ordered", text: om[2]!, n: parseInt(om[1]!, 10) });
      i++;
      continue;
    }
    tokens.push({ kind: "text", text: trimmed });
    i++;
  }
  return tokens;
}

/** Renders inline markdown: **bold**, *italic*, `code`, [link](url), and
 *  ![alt](url) inline images. Image syntax is checked before link syntax
 *  since it's a superset (leading "!") of the same bracket/paren shape. */
function InlineMarkdown({ text }: { text: string }): ReactNode {
  const parts: ReactNode[] = [];
  // Combined regex for bold, italic, inline code, images, links
  const re =
    /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(<span key={key++}>{text.slice(last, match.index)}</span>);
    }
    if (match[2] !== undefined) {
      parts.push(
        <strong key={key++} className="font-semibold text-foreground">
          {match[2]}
        </strong>,
      );
    } else if (match[3] !== undefined) {
      parts.push(
        <em key={key++} className="italic">
          {match[3]}
        </em>,
      );
    } else if (match[4] !== undefined) {
      parts.push(
        <code
          key={key++}
          className="rounded bg-muted-foreground/15 px-1 py-0.5 font-mono text-[0.8em]"
        >
          {match[4]}
        </code>,
      );
    } else if (match[6] !== undefined) {
      // ![alt](url) — inline image
      parts.push(
        <img
          key={key++}
          src={match[6]}
          alt={match[5] ?? ""}
          loading="lazy"
          className="my-1 block max-h-64 max-w-full rounded-lg border border-border object-contain"
        />,
      );
    } else if (match[7] !== undefined && match[8] !== undefined) {
      parts.push(
        <a
          key={key++}
          href={match[8]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-primary/60 hover:text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          {match[7]}
        </a>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length)
    parts.push(<span key={key++}>{text.slice(last)}</span>);
  return <>{parts}</>;
}

/** Groups consecutive list items into ul/ol blocks. */
function buildNodes(tokens: Token[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < tokens.length) {
    const t = tokens[i]!;

    if (t.kind === "bullet") {
      const items: string[] = [];
      while (i < tokens.length && tokens[i]!.kind === "bullet") {
        items.push((tokens[i] as { text: string }).text);
        i++;
      }
      nodes.push(
        <ul key={key++} className="my-1.5 space-y-0.5 pl-4">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 text-sm leading-relaxed">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
              <span>
                <InlineMarkdown text={item} />
              </span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (t.kind === "ordered") {
      const items: { n: number; text: string }[] = [];
      while (i < tokens.length && tokens[i]!.kind === "ordered") {
        items.push(tokens[i] as { n: number; text: string; kind: "ordered" });
        i++;
      }
      nodes.push(
        <ol key={key++} className="my-1.5 space-y-0.5 pl-4">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 text-sm leading-relaxed">
              <span className="shrink-0 font-semibold text-primary/80">
                {item.n}.
              </span>
              <span>
                <InlineMarkdown text={item.text} />
              </span>
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    if (t.kind === "table") {
      nodes.push(
        <div key={key++} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                {t.header.map((cell, j) => (
                  <th
                    key={j}
                    className="px-2 py-1.5 text-left font-semibold text-foreground"
                  >
                    <InlineMarkdown text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, j) => (
                <tr key={j} className="border-b border-border/40 last:border-0">
                  {row.map((cell, k) => (
                    <td
                      key={k}
                      className="px-2 py-1.5 align-top text-foreground/90"
                    >
                      <InlineMarkdown text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      i++;
      continue;
    }

    if (t.kind === "h1") {
      nodes.push(
        <p
          key={key++}
          className="mt-2 text-base font-bold text-foreground first:mt-0"
        >
          <InlineMarkdown text={t.text} />
        </p>,
      );
    } else if (t.kind === "h2") {
      nodes.push(
        <p
          key={key++}
          className="mt-1.5 text-sm font-bold text-foreground first:mt-0"
        >
          <InlineMarkdown text={t.text} />
        </p>,
      );
    } else if (t.kind === "h3") {
      nodes.push(
        <p
          key={key++}
          className="mt-1 text-sm font-semibold text-foreground/90 first:mt-0"
        >
          <InlineMarkdown text={t.text} />
        </p>,
      );
    } else if (t.kind === "hr") {
      nodes.push(<hr key={key++} className="my-2 border-border/60" />);
    } else if (t.kind === "blank") {
      // collapse multiple blanks, skip leading/trailing
      const prev = nodes[nodes.length - 1];
      if (prev !== undefined) nodes.push(<div key={key++} className="h-1" />);
    } else {
      nodes.push(
        <p key={key++} className="text-sm leading-relaxed">
          <InlineMarkdown text={t.text} />
        </p>,
      );
    }
    i++;
  }

  // strip leading/trailing blank spacers (the div key={...} className="h-1" nodes)
  function isBlankSpacer(node: ReactNode): boolean {
    if (!node || typeof node !== "object") return false;
    const el = node as { type?: unknown; props?: { className?: string } };
    return el.type === "div" && el.props?.className === "h-1";
  }
  while (nodes.length > 0 && isBlankSpacer(nodes[0])) nodes.shift();
  while (nodes.length > 0 && isBlankSpacer(nodes[nodes.length - 1]))
    nodes.pop();

  return nodes;
}

export function MarkdownMessage({ text }: { text: string }) {
  const tokens = tokenize(text);
  const nodes = buildNodes(tokens);
  return <div className="space-y-0.5">{nodes}</div>;
}
