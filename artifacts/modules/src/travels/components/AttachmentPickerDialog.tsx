import { useState, useEffect } from "react";
import { Loader2, FileText, Mail, Paperclip, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type TravelsGmailMessageAttachment,
} from "@workspace/api-client-react";

function formatAttachmentSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentTypeLabel(a: TravelsGmailMessageAttachment): string {
  if (a.mimeType === "application/pdf") return "PDF";
  const sub = a.mimeType.split("/")[1] ?? a.mimeType;
  return sub.toUpperCase();
}

function stripExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot > 0 ? filename.slice(0, lastDot) : filename;
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
  onConfirm: (
    attachmentIds: string[],
    includeEmailBody: boolean,
    titles: Record<string, string>,
  ) => void;
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
  const [step, setStep] = useState<1 | 2>(1);
  const [titles, setTitles] = useState<Record<string, string>>({});

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
  const effectiveIncludeBody = includeBody || !hasAttachments;
  const selectedCount = checkedIds.size + (effectiveIncludeBody ? 1 : 0);

  const selectedAttachments = (data?.attachments ?? []).filter((a) =>
    checkedIds.has(a.attachmentId),
  );

  function goToNaming() {
    const init: Record<string, string> = {};
    for (const a of selectedAttachments) {
      init[a.attachmentId] =
        titles[a.attachmentId] ?? stripExtension(a.filename);
    }
    if (effectiveIncludeBody) {
      init["body"] =
        titles["body"] ??
        (data?.subject ? data.subject.slice(0, 80) : "Email text");
    }
    setTitles(init);
    setStep(2);
  }

  function handleConfirm() {
    onConfirm(Array.from(checkedIds), effectiveIncludeBody, titles);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isLinking) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? "Choose what to attach" : "Name your documents"}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Select which parts of this email to save as trip documents."
              : "Give each document a name — you can change these later."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <>
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
                          v
                            ? next.add(a.attachmentId)
                            : next.delete(a.attachmentId);
                          return next;
                        })
                      }
                    />
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {a.filename}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {attachmentTypeLabel(a)}
                        {a.size ? ` · ${formatAttachmentSize(a.size)}` : ""}
                      </p>
                    </div>
                  </label>
                ))}

                <label className="flex items-center gap-3 rounded-lg border border-card-border p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                  <Checkbox
                    checked={effectiveIncludeBody}
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
                onClick={goToNaming}
                disabled={isLoading || selectedCount === 0 || isLinking}
              >
                <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                {selectedCount === 0
                  ? "Select at least one"
                  : selectedCount === 1
                    ? "Next →"
                    : `Next → (${selectedCount} items)`}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3 py-1 max-h-72 overflow-y-auto pr-1">
              {selectedAttachments.map((a) => (
                <div key={a.attachmentId} className="space-y-1">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="truncate">{a.filename}</span>
                  </Label>
                  <Input
                    value={titles[a.attachmentId] ?? ""}
                    onChange={(e) =>
                      setTitles((prev) => ({
                        ...prev,
                        [a.attachmentId]: e.target.value,
                      }))
                    }
                    placeholder="Document title…"
                    className="h-8 text-sm"
                    autoFocus={
                      selectedAttachments[0]?.attachmentId === a.attachmentId
                    }
                  />
                </div>
              ))}

              {effectiveIncludeBody && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Mail className="h-3 w-3 shrink-0" />
                    Email body text
                  </Label>
                  <Input
                    value={titles["body"] ?? ""}
                    onChange={(e) =>
                      setTitles((prev) => ({ ...prev, body: e.target.value }))
                    }
                    placeholder="Document title…"
                    className="h-8 text-sm"
                    autoFocus={selectedAttachments.length === 0}
                  />
                </div>
              )}
            </div>

            <div className="flex justify-between gap-2 pt-3 border-t border-card-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(1)}
                disabled={isLinking}
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                Back
              </Button>
              <Button size="sm" onClick={handleConfirm} disabled={isLinking}>
                {isLinking ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Adding…
                  </>
                ) : (
                  <>
                    <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                    {selectedCount === 1
                      ? "Add to trip"
                      : `Add to trip (${selectedCount} items)`}
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
