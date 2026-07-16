import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useGetElaineAdminConfig,
  useUpdateElaineAdminConfig,
  getGetElaineAdminConfigQueryKey,
  useListElaineAdminModels,
  getListElaineAdminModelsQueryKey,
  type ElaineExtraModelsConfig,
  type ElaineTimeoutsConfig,
  type ElaineFeaturesConfig,
  type ElaineThresholdsConfig,
} from "@workspace/api-client-react";
import { Button } from "@workspace/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui";
import { Input } from "@workspace/ui";
import { Label } from "@workspace/ui";
import { Switch } from "@workspace/ui";
import { ElaineName } from "./ElaineAvatar";

/**
 * App-owner-only global configuration for every hardcoded model slot,
 * timeout, feature toggle, and threshold across Elaine, Pottery, Quilting,
 * and Travels — one row (`elaine_global_config`, id=1) applies to every user
 * and every app surface. Renders nothing for non-owner accounts: the
 * underlying query 403s and we treat that as "hide", not an error.
 */

function ModelPicker({
  label,
  hint,
  value,
  onChange,
  models,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  models: { id: string; name: string }[];
}) {
  const options =
    value && !models.some((m) => m.id === value)
      ? [{ id: value, name: value }, ...models]
      : models;
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select a model" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-foreground">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function ToggleField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-card-border p-3">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4 border-t border-card-border pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

export function GlobalConfigCard() {
  const qc = useQueryClient();
  const {
    data: config,
    isLoading,
    isError,
    error,
  } = useGetElaineAdminConfig({
    query: { queryKey: getGetElaineAdminConfigQueryKey(), retry: false },
  });
  const { data: openRouterModels = [], isLoading: modelsLoading } =
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
  const [models, setModels] = useState<ElaineExtraModelsConfig | null>(null);
  const [timeouts, setTimeouts] = useState<ElaineTimeoutsConfig | null>(null);
  const [features, setFeatures] = useState<ElaineFeaturesConfig | null>(null);
  const [thresholds, setThresholds] = useState<ElaineThresholdsConfig | null>(
    null,
  );

  useEffect(() => {
    if (config) {
      setChatModel(config.chatModel);
      setSubagentModel(config.subagentModel);
      setRequestTimeoutMs(config.requestTimeoutMs);
      setMaxResponseTokens(config.maxResponseTokens);
      setModels(config.models);
      setTimeouts(config.timeouts);
      setFeatures(config.features);
      setThresholds(config.thresholds);
    }
  }, [config]);

  const isForbidden =
    isError && (error as { status?: number } | undefined)?.status === 403;

  if (isForbidden) return null;
  if (isLoading) return null;
  if (isError) return null;
  if (!models || !timeouts || !features || !thresholds) return null;

  function handleSave() {
    if (!models || !timeouts || !features || !thresholds) return;
    updateConfig.mutate(
      {
        chatModel,
        subagentModel,
        requestTimeoutMs,
        maxResponseTokens,
        models,
        timeouts,
        features,
        thresholds,
      },
      {
        onSuccess: (result) => {
          qc.setQueryData(getGetElaineAdminConfigQueryKey(), {
            ...result,
            updatedAt: new Date().toISOString(),
          });
          toast.success("Updated global configuration");
        },
        onError: () => toast.error("Failed to update global configuration"),
      },
    );
  }

  const fusionModelsText = models.fusionModels.join(", ");

  return (
    <div className="rounded-2xl border border-card-border bg-card p-6 space-y-6">
      <div>
        <h2 className="font-serif text-lg text-foreground">
          Global Configuration
        </h2>
        <p className="text-xs text-muted-foreground">
          Models, timeouts, feature toggles, and thresholds across{" "}
          <ElaineName />, Pottery, Quilting, and Travels. Applies to every user
          and every app. Only you can see or change this.
        </p>
      </div>

      <Section
        title="Chat models"
        description={
          <>
            The models that drive <ElaineName />
            's replies and delegated sub-tasks.
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ModelPicker
            label="Main chat model"
            value={chatModel}
            onChange={setChatModel}
            models={openRouterModels}
          />
          <ModelPicker
            label="Subagent (worker) model"
            value={subagentModel}
            onChange={setSubagentModel}
            models={openRouterModels}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberField
            label="Request timeout (ms)"
            min={2000}
            max={30000}
            value={requestTimeoutMs}
            onChange={setRequestTimeoutMs}
          />
          <NumberField
            label="Max response tokens"
            min={50}
            max={4000}
            value={maxResponseTokens}
            onChange={setMaxResponseTokens}
          />
        </div>
      </Section>

      <Section
        title="Other model slots"
        description="Every other OpenRouter/Voyage/Jina model used across Pottery, Quilting, and Travels."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ModelPicker
            label="Fast vision"
            value={models.fastVision}
            onChange={(v) => setModels({ ...models, fastVision: v })}
            models={openRouterModels}
          />
          <ModelPicker
            label="Smart vision"
            value={models.smartVision}
            onChange={(v) => setModels({ ...models, smartVision: v })}
            models={openRouterModels}
          />
          <ModelPicker
            label="Advisor"
            value={models.advisor}
            onChange={(v) => setModels({ ...models, advisor: v })}
            models={openRouterModels}
          />
          <ModelPicker
            label="Research"
            value={models.research}
            onChange={(v) => setModels({ ...models, research: v })}
            models={openRouterModels}
          />
          <ModelPicker
            label="Expert panel (alt)"
            value={models.expertPanelAlt}
            onChange={(v) => setModels({ ...models, expertPanelAlt: v })}
            models={openRouterModels}
          />
          <ModelPicker
            label="Embedding"
            value={models.embedding}
            onChange={(v) => setModels({ ...models, embedding: v })}
            models={openRouterModels}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-foreground">
              Voyage reranker model
            </Label>
            <Input
              value={models.rerank}
              onChange={(e) => setModels({ ...models, rerank: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-foreground">
              Jina CLIP visual embed model
            </Label>
            <Input
              value={models.visualEmbed}
              onChange={(e) =>
                setModels({ ...models, visualEmbed: e.target.value })
              }
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-foreground">
              Fusion panel models (comma-separated)
            </Label>
            <Input
              value={fusionModelsText}
              onChange={(e) =>
                setModels({
                  ...models,
                  fusionModels: e.target.value
                    .split(",")
                    .map((m) => m.trim())
                    .filter(Boolean),
                })
              }
            />
            <p className="text-xs text-muted-foreground">
              Independent multi-model panel used only for the two Fusion
              escalation tiers (pottery expert attribution, travel document
              extraction fallback).
            </p>
          </div>
          <ModelPicker
            label="Fusion judge"
            value={models.fusionJudge}
            onChange={(v) => setModels({ ...models, fusionJudge: v })}
            models={openRouterModels}
          />
        </div>
      </Section>

      <Section
        title="Timeouts"
        description="Per-feature request timeouts, in milliseconds."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberField
            label="Expert consult"
            min={1000}
            max={60000}
            value={timeouts.expertConsultMs}
            onChange={(v) => setTimeouts({ ...timeouts, expertConsultMs: v })}
          />
          <NumberField
            label="Reranker"
            min={1000}
            max={60000}
            value={timeouts.rerankerMs}
            onChange={(v) => setTimeouts({ ...timeouts, rerankerMs: v })}
          />
          <NumberField
            label="Geocoding"
            min={1000}
            max={30000}
            value={timeouts.geocodingMs}
            onChange={(v) => setTimeouts({ ...timeouts, geocodingMs: v })}
          />
          <NumberField
            label="Fusion"
            min={1000}
            max={120000}
            value={timeouts.fusionMs}
            onChange={(v) => setTimeouts({ ...timeouts, fusionMs: v })}
          />
        </div>
      </Section>

      <Section title="Feature toggles">
        <div className="space-y-2">
          <ToggleField
            label="Enable Advisor escalation"
            checked={features.enableAdvisor}
            onChange={(v) => setFeatures({ ...features, enableAdvisor: v })}
          />
          <ToggleField
            label="Enable Subagent delegation"
            checked={features.enableSubagent}
            onChange={(v) => setFeatures({ ...features, enableSubagent: v })}
          />
          <ToggleField
            label="Enable Fusion for pottery expert attribution"
            checked={features.enableFusionPotteryExpert}
            onChange={(v) =>
              setFeatures({ ...features, enableFusionPotteryExpert: v })
            }
          />
          <ToggleField
            label="Enable Fusion for travel document extraction fallback"
            checked={features.enableFusionTravelDocFallback}
            onChange={(v) =>
              setFeatures({ ...features, enableFusionTravelDocFallback: v })
            }
          />
        </div>
      </Section>

      <Section
        title="Thresholds"
        description="Similarity bands, crop ratios, image quality, and per-feature token caps."
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <NumberField
            label="Pottery similarity: Yes"
            min={0}
            max={1}
            step={0.01}
            value={thresholds.potterySimilarityYes}
            onChange={(v) =>
              setThresholds({ ...thresholds, potterySimilarityYes: v })
            }
          />
          <NumberField
            label="Pottery similarity: Maybe"
            min={0}
            max={1}
            step={0.01}
            value={thresholds.potterySimilarityMaybe}
            onChange={(v) =>
              setThresholds({ ...thresholds, potterySimilarityMaybe: v })
            }
          />
          <NumberField
            label="Pottery similarity: No"
            min={0}
            max={1}
            step={0.01}
            value={thresholds.potterySimilarityNo}
            onChange={(v) =>
              setThresholds({ ...thresholds, potterySimilarityNo: v })
            }
          />
          <NumberField
            label="Visual embed crop top"
            min={0}
            max={1}
            step={0.01}
            value={thresholds.visualEmbedCropTop}
            onChange={(v) =>
              setThresholds({ ...thresholds, visualEmbedCropTop: v })
            }
          />
          <NumberField
            label="Visual embed crop height"
            min={0}
            max={1}
            step={0.01}
            value={thresholds.visualEmbedCropHeight}
            onChange={(v) =>
              setThresholds({ ...thresholds, visualEmbedCropHeight: v })
            }
          />
          <NumberField
            label="AI JPEG quality"
            min={1}
            max={100}
            value={thresholds.aiJpegQuality}
            onChange={(v) => setThresholds({ ...thresholds, aiJpegQuality: v })}
          />
          <NumberField
            label="Pottery zone analysis max tokens"
            min={50}
            max={4000}
            value={thresholds.potteryZoneAnalysisMaxTokens}
            onChange={(v) =>
              setThresholds({
                ...thresholds,
                potteryZoneAnalysisMaxTokens: v,
              })
            }
          />
          <NumberField
            label="Pottery backstamp max tokens"
            min={50}
            max={4000}
            value={thresholds.potteryBackstampMaxTokens}
            onChange={(v) =>
              setThresholds({ ...thresholds, potteryBackstampMaxTokens: v })
            }
          />
          <NumberField
            label="Travel doc extraction max tokens"
            min={50}
            max={4000}
            value={thresholds.travelDocExtractionMaxTokens}
            onChange={(v) =>
              setThresholds({
                ...thresholds,
                travelDocExtractionMaxTokens: v,
              })
            }
          />
        </div>
      </Section>

      <div className="flex items-center gap-3 border-t border-card-border pt-5">
        <Button
          onClick={handleSave}
          disabled={updateConfig.isPending || modelsLoading}
        >
          {updateConfig.isPending ? "Saving…" : "Save global configuration"}
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
