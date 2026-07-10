import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Pencil,
  Inbox,
  Star,
  Send,
  FileText,
  AlertTriangle,
  Trash2,
  Mail,
  Tag,
  ChevronDown,
} from "lucide-react";
import { useState } from "react";
import type { GmailLabel } from "@workspace/gmail-ui";

export type LabelId =
  | "INBOX"
  | "STARRED"
  | "SENT"
  | "DRAFTS"
  | "SPAM"
  | "TRASH"
  | "ALL"
  | string;

const SYSTEM_LABELS: {
  id: LabelId;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "INBOX", name: "Inbox", icon: Inbox },
  { id: "STARRED", name: "Starred", icon: Star },
  { id: "SENT", name: "Sent", icon: Send },
  { id: "DRAFTS", name: "Drafts", icon: FileText },
  { id: "SPAM", name: "Spam", icon: AlertTriangle },
  { id: "TRASH", name: "Trash", icon: Trash2 },
  { id: "ALL", name: "All Mail", icon: Mail },
];

interface GmailSidebarProps {
  selectedLabel: LabelId;
  onSelectLabel: (id: LabelId) => void;
  onCompose: () => void;
  labels?: GmailLabel[];
}

function NavItem({
  icon: Icon,
  label,
  selected,
  unread,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  selected: boolean;
  unread?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 w-full rounded-full px-3 py-1.5 text-sm font-medium transition-colors text-left",
        selected
          ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
          : "text-foreground/80 hover:bg-muted",
      )}
    >
      <Icon
        className={cn(
          "w-4 h-4 flex-shrink-0",
          selected
            ? "text-blue-600 dark:text-blue-400"
            : "text-muted-foreground",
        )}
      />
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {unread != null && unread > 0 && (
        <span className="text-xs font-semibold text-foreground/70">
          {unread > 999 ? "999+" : unread}
        </span>
      )}
    </button>
  );
}

export function GmailSidebar({
  selectedLabel,
  onSelectLabel,
  onCompose,
  labels = [],
}: GmailSidebarProps) {
  const [userLabelsOpen, setUserLabelsOpen] = useState(false);

  const userLabels = labels.filter(
    (l) => l.type === "user" && l.name !== "CHAT",
  );

  const inboxLabel = labels.find((l) => l.id === "INBOX");
  const draftsLabel = labels.find((l) => l.id === "DRAFT");

  function unreadFor(id: string): number | undefined {
    const l = labels.find((lbl) => lbl.id === id);
    return l?.threadsUnread ?? l?.messagesUnread;
  }

  return (
    <div className="flex flex-col h-full py-2">
      <div className="px-3 pb-3">
        <Button
          onClick={onCompose}
          className="w-full justify-start gap-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white shadow-md font-medium"
          size="default"
        >
          <Pencil className="w-4 h-4" />
          Compose
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto px-1 space-y-0.5">
        {SYSTEM_LABELS.map(({ id, name, icon }) => (
          <NavItem
            key={id}
            icon={icon}
            label={name}
            selected={selectedLabel === id}
            unread={
              id === "INBOX"
                ? unreadFor("INBOX")
                : id === "DRAFTS"
                  ? unreadFor("DRAFT")
                  : undefined
            }
            onClick={() => onSelectLabel(id)}
          />
        ))}

        {userLabels.length > 0 && (
          <>
            <div className="pt-2 pb-1">
              <button
                onClick={() => setUserLabelsOpen((v) => !v)}
                className="flex items-center gap-2 px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-full hover:text-foreground"
              >
                <ChevronDown
                  className={cn(
                    "w-3 h-3 transition-transform",
                    userLabelsOpen && "rotate-180",
                  )}
                />
                Labels
              </button>
            </div>
            {userLabelsOpen &&
              userLabels.map((l) => (
                <NavItem
                  key={l.id}
                  icon={Tag}
                  label={l.name}
                  selected={selectedLabel === l.id}
                  unread={l.threadsUnread}
                  onClick={() => onSelectLabel(l.id)}
                />
              ))}
          </>
        )}
      </nav>
    </div>
  );
}
