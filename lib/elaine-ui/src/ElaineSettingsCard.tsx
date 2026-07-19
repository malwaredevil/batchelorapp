import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Brain, ArrowRight } from "lucide-react";
import {
  useGetElaineSettings,
  useUpdateElaineSettings,
  getGetElaineSettingsQueryKey,
  useListElaineMemory,
  type ActionConfirmationMode,
  type ChatWindowSize,
} from "@workspace/api-client-react";
import { Button } from "@workspace/ui";
import { Switch } from "@workspace/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui";
import { ElaineAvatar, ElaineWordmark, ElaineName } from "./ElaineAvatar";

/**
 * Shared "Elaine" settings card — enable/disable, action-confirmation mode,
 * and household memory management. Used identically across Travels, the
 * Batchelor hub Account page, and the standalone Elaine module so there is
 * one canonical implementation instead of copy-pasted variants.
 */
export function ElaineSettingsCard({
  subtitle = "Your household's AI assistant",
}: {
  subtitle?: string;
}) {
  const qc = useQueryClient();
  const { data: assistantSettings, isLoading: settingsLoading } =
    useGetElaineSettings();
  const updateAssistantSettings = useUpdateElaineSettings();
  const { data: memory = [], isLoading: memoryLoading } = useListElaineMemory();

  function handleToggle(enabled: boolean) {
    updateAssistantSettings.mutate(
      { enabled },
      {
        onSuccess: (result) => {
          qc.setQueryData(getGetElaineSettingsQueryKey(), result);
          toast.success(
            enabled ? (
              <>
                <ElaineName /> is back!
              </>
            ) : (
              <>
                <ElaineName /> is turned off
              </>
            ),
          );
        },
        onError: () =>
          toast.error(
            <>
              Failed to update <ElaineName /> settings
            </>,
          ),
      },
    );
  }

  function handleModeChange(actionConfirmationMode: ActionConfirmationMode) {
    updateAssistantSettings.mutate(
      { actionConfirmationMode },
      {
        onSuccess: (result) => {
          qc.setQueryData(getGetElaineSettingsQueryKey(), result);
          toast.success(
            <>
              Updated how <ElaineName /> confirms actions
            </>,
          );
        },
        onError: () =>
          toast.error(
            <>
              Failed to update <ElaineName /> settings
            </>,
          ),
      },
    );
  }

  function handleWindowSizeChange(chatWindowSize: ChatWindowSize) {
    updateAssistantSettings.mutate(
      { chatWindowSize },
      {
        onSuccess: (result) => {
          qc.setQueryData(getGetElaineSettingsQueryKey(), result);
          toast.success(
            <>
              Updated <ElaineName />
              's chat window size
            </>,
          );
        },
        onError: () =>
          toast.error(
            <>
              Failed to update <ElaineName /> settings
            </>,
          ),
      },
    );
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card p-6 space-y-5">
      <div className="flex items-center gap-3">
        <ElaineAvatar size={40} />
        <div>
          <h2 className="font-serif text-lg text-foreground flex items-center gap-1.5">
            <ElaineWordmark />
          </h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-card-border p-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            Enable <ElaineName />
          </p>
          <p className="text-xs text-muted-foreground">
            Shows the floating assistant bubble across every page.
          </p>
        </div>
        <Switch
          checked={assistantSettings?.enabled ?? true}
          onCheckedChange={handleToggle}
          disabled={settingsLoading || updateAssistantSettings.isPending}
        />
      </div>

      <div className="space-y-2 rounded-lg border border-card-border p-4">
        <p className="text-sm font-medium text-foreground">
          How <ElaineName /> confirms actions
        </p>
        <p className="text-xs text-muted-foreground pb-1">
          When <ElaineName /> proposes a change (like adding a reminder or
          trip), choose how you want to approve it. You can also just tell her
          in chat to switch modes.
        </p>
        <Select
          value={assistantSettings?.actionConfirmationMode ?? "one_by_one"}
          onValueChange={(value) =>
            handleModeChange(value as ActionConfirmationMode)
          }
          disabled={settingsLoading || updateAssistantSettings.isPending}
        >
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one_by_one">
              One at a time (safest, default)
            </SelectItem>
            <SelectItem value="all_at_once">All together</SelectItem>
            <SelectItem value="auto_run">
              Run automatically, no confirmation
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 rounded-lg border border-card-border p-4">
        <p className="text-sm font-medium text-foreground">Chat window size</p>
        <p className="text-xs text-muted-foreground pb-1">
          How big the floating chat popup is on desktop. On phones it always
          fills the screen width.
        </p>
        <Select
          value={assistantSettings?.chatWindowSize ?? "compact"}
          onValueChange={(value) =>
            handleWindowSizeChange(value as ChatWindowSize)
          }
          disabled={settingsLoading || updateAssistantSettings.isPending}
        >
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="compact">Compact (default)</SelectItem>
            <SelectItem value="comfortable">Comfortable</SelectItem>
            <SelectItem value="large">Large</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <a
        href="/elaine/memory"
        className="flex items-center justify-between gap-3 rounded-lg border border-card-border p-4 hover:border-primary/30 hover:bg-muted/30 transition-colors group"
      >
        <div className="flex items-center gap-3">
          <Brain className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          <div>
            <p className="text-sm font-medium text-foreground">
              What <ElaineName /> remembers
            </p>
            <p className="text-xs text-muted-foreground">
              {memoryLoading
                ? "Loading…"
                : memory.length === 0
                  ? "Nothing remembered yet"
                  : `${memory.filter((m) => m.type !== "summary").length} fact${memory.filter((m) => m.type !== "summary").length !== 1 ? "s" : ""} stored`}
            </p>
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </a>
    </div>
  );
}
