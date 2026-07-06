import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  useGetElaineSettings,
  useUpdateElaineSettings,
  getGetElaineSettingsQueryKey,
  useListElaineMemory,
  getListElaineMemoryQueryKey,
  useDeleteElaineMemoryItem,
  type ActionConfirmationMode,
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
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
  const { data: memory = [], isLoading: memoryLoading } =
    useListElaineMemory();
  const deleteMemory = useDeleteElaineMemoryItem();

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

  function handleDeleteMemory(id: number) {
    deleteMemory.mutate(id, {
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: getListElaineMemoryQueryKey() }),
      onError: () => toast.error("Failed to remove memory"),
    });
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

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          What <ElaineName /> remembers
        </p>
        <p className="text-xs text-muted-foreground pb-1">
          Shared facts <ElaineName /> has picked up about your household.
        </p>
        {memoryLoading && (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
        {!memoryLoading && memory.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            Nothing remembered yet.
          </p>
        )}
        {memory.length > 0 && (
          <ul className="space-y-1.5">
            {memory.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
              >
                <span className="text-foreground">{m.content}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeleteMemory(m.id)}
                  disabled={deleteMemory.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
