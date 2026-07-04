import { useState, useEffect } from "react";
import { Loader2, FileText, Mail, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  useGetGmailMessage,
  getGetGmailMessageQueryKey,
  type GmailMessageAttachment,
} from "@workspace/api-client-react";

function formatAttachmentSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentTypeLabel(a: GmailMessageAttachment): string {
  if (a.mimeType === "application/pdf") return "PDF";
  const sub = a.mimeType.split("/")[1] ?? a.mimeType;
  return sub.toUpperCase();
}

export function AttachmentPickerDialog({
  messageId,
  onClose,
  onConfirm,
  isLinking,
  defaultAllUnchecked = false,
}: {
  messageId: string;
  onClose: () => void;
  onConfirm: (attachmentIds: string[], includeEmailBody: boolean) => void;
  isLinking: boolean;
  /** When true, all attachment checkboxes start unchecked (used when adding
   *  more documents from an email that's already partially linked). */
  defaultAllUnchecked?: boolean;
}) {
  const { data, isLoading } = useGetGmailMessage(messageId, {
    query: { queryKey: getGetGmailMessageQueryKey(messageId) },
  });
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [includeBody, setIncludeBody] = useState(false);

  useEffect(() => {
    if (!data) return;
    if (defaultAllUnchecked) {
      setCheckedIds(new Set());
      setIncludeBody(false);
    } else {
      setCheckedIds(new Set(data.attachments.map((a) => a.attachmentId)));
      setIncludeBody(data.attachments.length === 0);
    }
  }, [data, defaultAllUnchecked]);

  const hasAttachments = (data?.attachments.length ?? 0) > 0;
  const selectedCount = checkedIds.size + (includeBody ? 1 : 0);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !isLinking) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Choose what to attach</DialogTitle>
          <DialogDescription>
            Select which parts of this email to save as trip documents.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2 py-1">
            {data.attachments.map((a) => (
              <label
                key={a.attachmentId}
                className="flex items-center gap-3 rounded-lg border border-card-border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <Checkbox
                  checked={checkedIds.has(a.attachmentId)}
                  onCheckedChange={(v) =>
                    setCheckedIds((prev) => {
                      const next = new Set(prev);
                      v ? next.add(a.attachmentId) : next.delete(a.attachmentId);
                      return next;
                    })
                  }
                />
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.filename}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {attachmentTypeLabel(a)}
                    {a.size ? ` · ${formatAttachmentSize(a.size)}` : ""}
                  </p>
                </div>
              </label>
            ))}

            <label className="flex items-center gap-3 rounded-lg border border-card-border p-3 cursor-pointer hover:bg-muted/50 transition-colors">
              <Checkbox
                checked={includeBody || !hasAttachments}
                disabled={!hasAttachments}
                onCheckedChange={(v) => setIncludeBody(!!v)}
              />
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Email body text</p>
                <p className="text-[11px] text-muted-foreground">
                  {hasAttachments
                    ? "Also include the email's plain-text content"
                    : "The email text will be saved as a document"}
                </p>
              </div>
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-card-border">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isLinking}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() =>
              onConfirm(Array.from(checkedIds), includeBody || !hasAttachments)
            }
            disabled={isLoading || selectedCount === 0 || isLinking}
          >
            {isLinking ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Adding…
              </>
            ) : (
              <>
                <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                {selectedCount === 0
                  ? "Select at least one"
                  : selectedCount === 1
                    ? "Add to trip"
                    : `Add to trip (${selectedCount} items)`}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
