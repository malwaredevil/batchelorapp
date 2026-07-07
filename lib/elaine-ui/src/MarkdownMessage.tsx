import { type ReactNode } from "react";

/** Lightweight markdown renderer covering the subset Elaine uses:
 *  bold, italic, inline code, headers (h1-h3), bullet lists, numbered lists,
 *  horizontal rules, and paragraphs. No external dependencies needed. */

type Token =
  | { kind: "h1" | "h2" | "h3"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "ordered"; text: string; n: number }
  | { kind: "hr" }
  | { kind: "blank" }
  | { kind: "text"; text: string };

function tokenize(markdown: string): Token[] {
  const lines = markdown.split("\n");
  const tokens: Token[] = [];
  for (const raw of lines) {
    const line = raw;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed === "\r") {
      tokens.push({ kind: "blank" });
      continue;
    }
    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      tokens.push({ kind: "hr" });
      continue;
    }
    const hm = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      const level = hm[1]!.length as 1 | 2 | 3;
      tokens.push({
        kind: level === 1 ? "h1" : level === 2 ? "h2" : "h3",
        text: hm[2]!,
      });
      continue;
    }
    const bm = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bm) {
      tokens.push({ kind: "bullet", text: bm[1]! });
      continue;
    }
    const om = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (om) {
      tokens.push({ kind: "ordered", text: om[2]!, n: parseInt(om[1]!, 10) });
      continue;
    }
    tokens.push({ kind: "text", text: trimmed });
  }
  return tokens;
}

/** Renders inline markdown: **bold**, *italic*, `code`, and [link](url). */
function InlineMarkdown({ text }: { text: string }): ReactNode {
  const parts: ReactNode[] = [];
  // Combined regex for bold, italic, inline code, links
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\(([^)]+)\))/g;
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
    } else if (match[5] !== undefined && match[6] !== undefined) {
      parts.push(
        <a
          key={key++}
          href={match[6]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-primary/60 hover:text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          {match[5]}
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
