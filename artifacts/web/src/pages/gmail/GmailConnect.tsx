import { Mail, ShieldCheck, Inbox, Send, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export function GmailConnect() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20 px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mb-6 shadow-lg">
        <Mail className="w-8 h-8 text-white" />
      </div>

      <h1 className="text-2xl font-semibold mb-2">Connect your Gmail</h1>
      <p className="text-muted-foreground max-w-sm mb-8">
        Read, write, and manage your email right inside Batchelor. Your emails
        stay in Google — we just provide a cleaner view.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10 text-left max-w-xl w-full">
        <div className="rounded-xl border border-border bg-card p-4">
          <Inbox className="w-5 h-5 text-blue-500 mb-2" />
          <div className="text-sm font-medium mb-1">Read & search</div>
          <div className="text-xs text-muted-foreground">
            Browse your inbox and search across all messages.
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <Send className="w-5 h-5 text-blue-500 mb-2" />
          <div className="text-sm font-medium mb-1">Compose & reply</div>
          <div className="text-xs text-muted-foreground">
            Write new emails and reply to threads.
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <FileText className="w-5 h-5 text-blue-500 mb-2" />
          <div className="text-sm font-medium mb-1">Manage messages</div>
          <div className="text-xs text-muted-foreground">
            Archive, trash, star and organise with labels.
          </div>
        </div>
      </div>

      <a href="/api/gmail/connect">
        <Button
          size="lg"
          className="bg-blue-600 hover:bg-blue-700 text-white gap-2 shadow"
        >
          <Mail className="w-4 h-4" />
          Connect Gmail account
        </Button>
      </a>

      <div className="flex items-center gap-2 mt-6 text-xs text-muted-foreground">
        <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
        <span>OAuth secured — Batchelor never stores your password</span>
      </div>
    </div>
  );
}
