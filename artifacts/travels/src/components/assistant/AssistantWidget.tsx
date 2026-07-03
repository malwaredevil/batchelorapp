import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { MessageCircle, X, MoreVertical, Send, ArrowRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  useGetAssistantConversation,
  useSendAssistantMessage,
  useNewAssistantConversation,
  useGetAssistantSettings,
  useUpdateAssistantSettings,
  getGetAssistantConversationQueryKey,
  type AssistantMessage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ElaineAvatar, ElaineWordmark } from "./ElaineAvatar";
import { useAssistantPageContextReader } from "@/lib/assistant-context";

const HIDE_FOR_VISIT_KEY = "elaine_hidden_for_visit";

export function AssistantWidget() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const getPageContext = useAssistantPageContextReader();

  const [open, setOpen] = useState(false);
  const [hiddenForVisit, setHiddenForVisit] = useState(
    () => sessionStorage.getItem(HIDE_FOR_VISIT_KEY) === "1",
  );
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [pendingNavigate, setPendingNavigate] = useState<{ path: string; reason: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: settings } = useGetAssistantSettings();
  const updateSettings = useUpdateAssistantSettings();
  const { data: conversation } = useGetAssistantConversation({
    query: { enabled: open && !initialized, queryKey: getGetAssistantConversationQueryKey() },
  });
  const sendMessage = useSendAssistantMessage();
  const newConversation = useNewAssistantConversation();

  useEffect(() => {
    if (conversation && !initialized) {
      setMessages(conversation.messages);
      setInitialized(true);
    }
  }, [conversation, initialized]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, sendMessage.isPending]);

  if (!settings?.enabled || hiddenForVisit) {
    return null;
  }

  function handleHideForVisit() {
    sessionStorage.setItem(HIDE_FOR_VISIT_KEY, "1");
    setHiddenForVisit(true);
    setOpen(false);
  }

  function handleTurnOff() {
    updateSettings.mutate(
      { enabled: false },
      {
        onSuccess: () => {
          setOpen(false);
          toast.info("elAIne is turned off. Re-enable her anytime from Settings.");
        },
      },
    );
  }

  function handleNewConversation() {
    newConversation.mutate(undefined, {
      onSuccess: (result) => {
        setMessages(result.messages);
        setPendingNavigate(null);
        qc.setQueryData(getGetAssistantConversationQueryKey(), result);
      },
    });
  }

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || sendMessage.isPending) return;
    setInput("");
    setPendingNavigate(null);
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);

    sendMessage.mutate(
      { message: trimmed, pageContext: getPageContext() },
      {
        onSuccess: (result) => {
          setMessages(result.messages);
          if (result.navigate) setPendingNavigate(result.navigate);
        },
        onError: () => {
          toast.error("elAIne couldn't respond just now. Please try again.");
          setMessages((prev) => prev.slice(0, -1));
        },
      },
    );
  }

  function handleConfirmNavigate() {
    if (!pendingNavigate) return;
    navigate(pendingNavigate.path);
    setPendingNavigate(null);
    setOpen(false);
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open && (
        <div className="flex h-[32rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-card-border bg-card shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-border/50 bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <ElaineAvatar size={34} />
              <ElaineWordmark className="text-lg" />
            </div>
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onSelect={handleNewConversation} className="cursor-pointer">
                    <RotateCcw className="h-3.5 w-3.5 mr-2" />
                    New conversation
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={handleHideForVisit} className="cursor-pointer">
                    Hide for this visit
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleTurnOff} className="cursor-pointer text-destructive focus:text-destructive">
                    Turn off elAIne
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && !sendMessage.isPending && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <ElaineAvatar size={48} />
                <p className="text-sm text-muted-foreground">
                  Hi, I'm elAIne! Ask me anything about your trips, or whatever's on your screen.
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && <ElaineAvatar size={26} className="mt-0.5" />}
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "rounded-tr-sm bg-primary text-primary-foreground"
                      : "rounded-tl-sm bg-muted text-foreground"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {sendMessage.isPending && (
              <div className="flex gap-2.5 justify-start">
                <ElaineAvatar size={26} className="mt-0.5" />
                <div className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-3 text-muted-foreground">
                  <span className="inline-flex gap-1 text-lg leading-none">
                    <span className="animate-bounce" style={{ animationDelay: "0ms" }}>·</span>
                    <span className="animate-bounce" style={{ animationDelay: "150ms" }}>·</span>
                    <span className="animate-bounce" style={{ animationDelay: "300ms" }}>·</span>
                  </span>
                </div>
              </div>
            )}

            {pendingNavigate && (
              <div className="ml-8 flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">
                  Take you to <span className="font-medium text-foreground">{pendingNavigate.path}</span>?
                </p>
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs" onClick={handleConfirmNavigate}>
                    <ArrowRight className="h-3 w-3 mr-1" />
                    Yes, take me there
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setPendingNavigate(null)}
                  >
                    No thanks
                  </Button>
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>

          <div className="flex gap-2 border-t border-border/50 p-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask elAIne anything…"
              className="min-h-9 flex-1 resize-none"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={sendMessage.isPending}
            />
            <Button size="icon" onClick={handleSend} disabled={!input.trim() || sendMessage.isPending}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border border-card-border bg-card py-2 pl-2 pr-4 shadow-lg transition-transform hover:scale-105"
          aria-label="Open elAIne assistant"
        >
          <ElaineAvatar size={36} />
          <span className="flex items-center gap-1 text-sm font-medium">
            <ElaineWordmark />
          </span>
          <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
