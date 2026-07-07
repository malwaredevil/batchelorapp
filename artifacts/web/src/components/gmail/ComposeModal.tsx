import { useState, useRef, useEffect } from "react";
import { X, Minus, Maximize2, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ComposeParams } from "@/hooks/use-gmail";
import { useGmailSend } from "@/hooks/use-gmail";
import { useToast } from "@/hooks/use-toast";

interface ComposeModalProps {
  initial?: Partial<ComposeParams>;
  onClose: () => void;
}

export function ComposeModal({ initial = {}, onClose }: ComposeModalProps) {
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const [to, setTo] = useState(initial.to ?? "");
  const [cc, setCc] = useState(initial.cc ?? "");
  const [bcc, setBcc] = useState(initial.bcc ?? "");
  const [showCc, setShowCc] = useState(!!initial.cc);
  const [showBcc, setShowBcc] = useState(!!initial.bcc);
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [body, setBody] = useState(initial.body ?? "");

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const send = useGmailSend();

  // Focus body on mount if replying (has initial.to)
  useEffect(() => {
    if (initial.to) bodyRef.current?.focus();
  }, []);

  async function handleSend() {
    if (!to.trim()) {
      toast({ title: "Add a recipient", description: "Please fill in the To field.", variant: "destructive" });
      return;
    }
    try {
      await send.mutateAsync({
        to: to.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject: subject.trim(),
        body,
        inReplyTo: initial.inReplyTo,
        references: initial.references,
        threadId: initial.threadId,
      });
      toast({ title: "Message sent", description: "Your email has been sent." });
      onClose();
    } catch (err) {
      toast({
        title: "Failed to send",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  }

  return (
    <div
      className={cn(
        "fixed z-[100] bg-card border border-border rounded-2xl shadow-2xl flex flex-col transition-all",
        expanded
          ? "inset-8"
          : minimized
          ? "bottom-0 right-4 sm:right-8 w-72 h-12 rounded-b-none"
          : "bottom-0 right-4 sm:right-8 w-full sm:w-[520px] h-[480px] rounded-b-none",
      )}
    >
      {/* Title bar */}
      <div
        className={cn(
          "flex items-center justify-between px-4 py-3 bg-muted/60 rounded-t-2xl cursor-pointer select-none",
          minimized ? "rounded-b-2xl" : "",
        )}
        onClick={minimized ? () => setMinimized(false) : undefined}
      >
        <span className="text-sm font-semibold truncate">
          {subject || "New Message"}
        </span>
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={(e) => { e.stopPropagation(); setMinimized((v) => !v); setExpanded(false); }}
            className="p-1 rounded hover:bg-muted"
            title={minimized ? "Restore" : "Minimise"}
          >
            <Minus className="w-4 h-4 text-muted-foreground" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); setMinimized(false); }}
            className="p-1 rounded hover:bg-muted"
            title={expanded ? "Restore" : "Expand"}
          >
            <Maximize2 className="w-4 h-4 text-muted-foreground" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-1 rounded hover:bg-muted"
            title="Discard draft"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* Fields */}
          <div className="border-b border-border">
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/50">
              <label className="text-xs text-muted-foreground w-8 flex-shrink-0">To</label>
              <Input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border-none shadow-none focus-visible:ring-0 px-0 text-sm h-7"
                placeholder="Recipients"
              />
              <div className="flex gap-2 text-xs text-muted-foreground flex-shrink-0">
                {!showCc && <button onClick={() => setShowCc(true)} className="hover:text-foreground">Cc</button>}
                {!showBcc && <button onClick={() => setShowBcc(true)} className="hover:text-foreground">Bcc</button>}
              </div>
            </div>

            {showCc && (
              <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/50">
                <label className="text-xs text-muted-foreground w-8 flex-shrink-0">Cc</label>
                <Input
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  className="border-none shadow-none focus-visible:ring-0 px-0 text-sm h-7"
                  placeholder="Cc"
                />
              </div>
            )}
            {showBcc && (
              <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/50">
                <label className="text-xs text-muted-foreground w-8 flex-shrink-0">Bcc</label>
                <Input
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  className="border-none shadow-none focus-visible:ring-0 px-0 text-sm h-7"
                  placeholder="Bcc"
                />
              </div>
            )}

            <div className="flex items-center gap-2 px-4 py-1.5">
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="border-none shadow-none focus-visible:ring-0 px-0 text-sm h-7 font-medium"
                placeholder="Subject"
              />
            </div>
          </div>

          {/* Body */}
          <Textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="flex-1 resize-none border-none shadow-none focus-visible:ring-0 rounded-none text-sm font-sans leading-relaxed p-4"
            placeholder="Write your message..."
          />

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 bg-background/50 rounded-b-none">
            <Button
              onClick={handleSend}
              disabled={send.isPending}
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full px-5"
            >
              {send.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Send
            </Button>
            <button
              onClick={onClose}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Discard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
