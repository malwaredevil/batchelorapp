import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useGetElaineAdminConfig,
  useUpdateElaineAdminConfig,
  getGetElaineAdminConfigQueryKey,
  useListElaineAdminModels,
  getListElaineAdminModelsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ElaineName } from "./ElaineAvatar";

/**
 * App-owner-only global config for Elaine's AI behaviour (model, timeout,
 * response length) — applies across every user and every app surface.
 * Distinct from the per-user card in ElaineSettingsCard. Renders nothing for
 * non-owner accounts: the underlying query 403s and we treat that as "hide",
 * not an error, since regular users should never see this section.
 */
export function ElaineAdminConfigCard() {
  const qc = useQueryClient();
  const { data: config, isLoading, isError, error } = useGetElaineAdminConfig({
    query: { queryKey: getGetElaineAdminConfigQueryKey(), retry: false },
  });
  const { data: models = [], isLoading: modelsLoading } =
    useListElaineAdminModels({
      query: {
        queryKey: getListElaineAdminModelsQueryKey(),
        retry: false,
        enabled: !!config,
      },
    });
  const updateConfig = useUpdateElaineAdminConfig();

  const [chatModel, setChatModel] = useState("");
  const [subagentModel, setSubagentModel] = useState("");
  const [requestTimeoutMs, setRequestTimeoutMs] = useState(12000);
  const [maxResponseTokens, setMaxResponseTokens] = useState(700);

  useEffect(() => {
    if (config) {
      setChatModel(config.chatModel);
      setSubagentModel(config.subagentModel);
      setRequestTimeoutMs(config.requestTimeoutMs);
      setMaxResponseTokens(config.maxResponseTokens);
    }
  }, [config]);

  const isForbidden =
    isError && (error as { status?: number } | undefined)?.status === 403;

  if (isForbidden) return null;
  if (isLoading) return null;
  if (isError) return null;

  function handleSave() {
    updateConfig.mutate(
      { chatModel, subagentModel, requestTimeoutMs, maxResponseTokens },
      {
        onSuccess: (result) => {
          qc.setQueryData(getGetElaineAdminConfigQueryKey(), {
            ...result,
            updatedAt: new Date().toISOString(),
          });
          toast.success(
            <>
              Updated global <ElaineName /> config
            </>,
          );
        },
        onError: () =>
          toast.error(
            <>
              Failed to update <ElaineName /> config
            </>,
          ),
      },
    );
  }

  const modelOptions =
    models.length > 0
      ? models
      : [
          { id: chatModel, name: chatModel },
          { id: subagentModel, name: subagentModel },
        ].filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i);

  return (
    <div className="rounded-2xl border border-card-border bg-card p-6 space-y-5">
      <div>
        <h2 className="font-serif text-lg text-foreground">
          Admin: global <ElaineName /> config
        </h2>
        <p className="text-xs text-muted-foreground">
          Applies to every user and every app. Only you can see or change
          this.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">
          Main chat model
        </Label>
        <Select value={chatModel} onValueChange={setChatModel}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {modelOptions.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The model that drives <ElaineName />'s replies and tool use.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">
          Subagent (worker) model
        </Label>
        <Select value={subagentModel} onValueChange={setSubagentModel}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {modelOptions.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Cheaper model delegated routine sub-tasks mid-conversation.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">
            Request timeout (ms)
          </Label>
          <Input
            type="number"
            min={2000}
            max={30000}
            value={requestTimeoutMs}
            onChange={(e) => setRequestTimeoutMs(Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">
            Max response tokens
          </Label>
          <Input
            type="number"
            min={50}
            max={4000}
            value={maxResponseTokens}
            onChange={(e) => setMaxResponseTokens(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={updateConfig.isPending || modelsLoading}
        >
          {updateConfig.isPending ? "Saving…" : "Save global config"}
        </Button>
        {config?.updatedAt && (
          <p className="text-xs text-muted-foreground">
            Last updated {new Date(config.updatedAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
