import { useState } from "react";
import { Copy, Check, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface ShareData {
  type: "quilt" | "fabric" | "pattern";
  name: string;
  subtitle?: string | null;
  details?: Record<string, string | number | null | undefined>;
  hashtags?: string[];
}

function buildCaption(data: ShareData): string {
  const typeEmoji: Record<ShareData["type"], string> = {
    quilt: "🪡",
    fabric: "🧵",
    pattern: "📐",
  };
  const typeLabel: Record<ShareData["type"], string> = {
    quilt: "Finished quilt",
    fabric: "Fabric in my collection",
    pattern: "Quilt pattern",
  };

  const lines: string[] = [];
  lines.push(`${typeEmoji[data.type]} ${typeLabel[data.type]}: ${data.name}`);
  if (data.subtitle) lines.push(data.subtitle);
  lines.push("");

  if (data.details) {
    for (const [key, value] of Object.entries(data.details)) {
      if (value != null && value !== "") {
        lines.push(`${key}: ${value}`);
      }
    }
    if (Object.values(data.details).some((v) => v != null)) lines.push("");
  }

  const tags = [
    "#quilting",
    "#quilt",
    "#quiltlove",
    "#fabriclover",
    "#quiltsofinstagram",
    ...(data.hashtags ?? []),
  ];
  lines.push(tags.join(" "));

  return lines.join("\n");
}

export function ShareModal({ data }: { data: ShareData }) {
  const [copied, setCopied] = useState(false);
  const caption = buildCaption(data);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      toast.success("Caption copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the text above and copy manually.");
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Share2 className="mr-2 h-3.5 w-3.5" />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share "{data.name}"</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">
            Copy this caption to share on Instagram, Facebook, or Pinterest.
          </p>
          <div
            className="cursor-text select-all rounded-lg border border-border bg-muted/50 p-3 text-sm leading-relaxed"
            onClick={handleCopy}
          >
            {caption.split("\n").map((line, i) => (
              <span key={i}>
                {line || <span>&nbsp;</span>}
                <br />
              </span>
            ))}
          </div>
          <Button
            onClick={handleCopy}
            className="w-full"
            variant={copied ? "secondary" : "default"}
          >
            {copied ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Copy caption
              </>
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Tip: Click the text above to select all, or use the button to copy.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
