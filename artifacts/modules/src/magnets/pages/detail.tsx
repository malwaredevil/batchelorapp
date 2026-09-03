import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  Pencil,
  Save,
  X,
  Trash2,
  RefreshCcw,
  Lock,
  Unlock,
} from "lucide-react";
import { ImageLightbox } from "@/quilting/components/image-lightbox";
import {
  addMagnetImage,
  useGetMagnet,
  useDeleteMagnet,
  useUpdateMagnet,
  useListMagnetCategories,
  useDeleteMagnetImage,
  useSetMagnetPrimaryImage,
  useUpdateMagnetImage,
  useReanalyzeMagnet,
  getUploadErrorMessage,
  getGetMagnetQueryKey,
  getListMagnetsQueryKey,
} from "@workspace/api-client-react";
import { ItemImageGallery } from "@workspace/image-capture";
import {
  CollectionDetailField,
  CollectionDetailLayout,
  CollectionDetailSkeleton,
  CollectionErrorState,
  trackAsyncAction,
  isAsyncActionBusy,
  useAsyncActionStatus,
} from "@workspace/collection-ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { magnetReanalyzeKey } from "@/magnets/lib/reanalyze-status";
import { usePageAssistantContext } from "@/magnets/lib/assistant-context";
import { formatElaineContextEntity } from "@workspace/elaine-ui";

export default function MagnetDetailPage() {
  const [, params] = useRoute("/magnets/item/:id");
  const id = Number(params?.id ?? 0);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const {
    data: item,
    isLoading,
    isError,
    refetch,
  } = useGetMagnet(id, {
    query: { enabled: !!id, queryKey: getGetMagnetQueryKey(id) },
  });

  const deleteMutation = useDeleteMagnet({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMagnetsQueryKey() });
        navigate("/magnets");
        toast.success("Magnet deleted");
      },
      onError: () => toast.error("Failed to delete magnet"),
    },
  });
  const updateMutation = useUpdateMagnet();
  const { data: categories = [] } = useListMagnetCategories();

  const deleteImageMutation = useDeleteMagnetImage();
  const setPrimaryMutation = useSetMagnetPrimaryImage();
  const relabelImageMutation = useUpdateMagnetImage();
  const reanalyze = useReanalyzeMagnet();

  const [isUploading, setIsUploading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "" });
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  usePageAssistantContext(
    "magnets-detail",
    item
      ? [
          `Magnet detail: ${formatElaineContextEntity({ entity: "magnet", id: item.id, label: item.name })}`,
          item.description ? `Description: ${item.description}` : null,
          item.categories.length
            ? `Categories: ${item.categories.map((category) => `${category.name} (categoryId ${category.id})`).join(", ")}`
            : "No categories.",
          `Name is ${item.lockedFields?.includes("name") ? "locked" : "unlocked"}; Description is ${item.lockedFields?.includes("description") ? "locked" : "unlocked"}.`,
          `Photos: ${item.images.length}; primary image id: ${item.primaryImageId ?? "none"}.`,
        ]
          .filter(Boolean)
          .join("\n")
      : "Loading magnet detail.",
  );

  const reanalyzeKey = magnetReanalyzeKey(id);
  const reanalyzeStatus = useAsyncActionStatus(reanalyzeKey);
  const isReanalyzeBusy =
    reanalyze.isPending || reanalyzeStatus === "processing";

  function enterEdit() {
    if (!item) return;
    setDraft({
      name: item.name,
      description: item.description ?? "",
    });
    setSelectedCategoryIds(item.categories.map((c) => c.id));
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
  }

  async function saveEdit() {
    if (!draft.name.trim()) {
      toast.error("Name cannot be empty.");
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id,
        data: {
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          categoryIds: selectedCategoryIds,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetMagnetQueryKey(id),
      });
      await queryClient.invalidateQueries({
        queryKey: getListMagnetsQueryKey(),
      });
      setIsEditing(false);
      toast.success("Saved.");
    } catch {
      toast.error("Failed to save changes.");
    }
  }

  function toggleLockedField(field: string) {
    if (!item) return;
    const current = item.lockedFields ?? [];
    const next = current.includes(field)
      ? current.filter((f) => f !== field)
      : [...current, field];
    updateMutation.mutate(
      { id, data: { lockedFields: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMagnetQueryKey(id) });
          toast.success(
            current.includes(field) ? "Field unlocked" : "Field locked",
          );
        },
        onError: () => toast.error("Failed to update lock"),
      },
    );
  }

  async function handleRefreshAi() {
    if (isAsyncActionBusy(reanalyzeKey)) {
      toast.info("AI refresh already running for this item.");
      return;
    }
    toast.loading("Refreshing AI analysis…", { id: "magnet-reanalyze" });
    const promise = reanalyze.mutateAsync({ id });
    trackAsyncAction(reanalyzeKey, promise);
    try {
      const result = await promise;
      toast.dismiss("magnet-reanalyze");
      toast.success("AI analysis refreshed");
      queryClient.setQueryData(getGetMagnetQueryKey(id), result);
      queryClient.invalidateQueries({ queryKey: getListMagnetsQueryKey() });
    } catch {
      toast.dismiss("magnet-reanalyze");
      toast.error("Refresh failed — try again");
    }
  }

  if (isLoading) return <CollectionDetailSkeleton />;

  if (isError || !item) {
    return (
      <div className="p-4">
        <CollectionErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  const lockedFields = item.lockedFields ?? [];

  const sortedImages = (item.images ?? [])
    .slice()
    .sort((a, b) => {
      if (a.id === item.primaryImageId) return -1;
      if (b.id === item.primaryImageId) return 1;
      return a.position - b.position;
    })
    .map((img) => ({
      id: img.id,
      url: img.url,
      label: img.label ?? null,
      isPrimary: img.id === item.primaryImageId,
    }));
  const lightboxImages = sortedImages.map((image) => image.url);

  return (
    <CollectionDetailLayout
      backLabel="Magnets"
      onBack={() => navigate("/magnets")}
      gallery={
        <>
          {lightboxIndex !== null && (
            <ImageLightbox
              src={lightboxImages[lightboxIndex] ?? ""}
              open
              onClose={() => setLightboxIndex(null)}
              images={lightboxImages}
              currentIndex={lightboxIndex}
              onNavigate={setLightboxIndex}
              labels={sortedImages.map((image) => image.label ?? "")}
            />
          )}
          <ItemImageGallery
            mainImageClassName="aspect-[4/3] max-h-[55vh] w-full object-cover"
            images={sortedImages}
            isUploading={isUploading}
            isMutating={
              deleteImageMutation.isPending ||
              setPrimaryMutation.isPending ||
              relabelImageMutation.isPending
            }
            onZoom={(url) => {
              const index = lightboxImages.indexOf(url);
              if (index >= 0) setLightboxIndex(index);
            }}
            onAddImage={async (file) => {
              setIsUploading(true);
              try {
                await addMagnetImage(id, { image: file });
                await Promise.all([
                  queryClient.invalidateQueries({
                    queryKey: getGetMagnetQueryKey(id),
                  }),
                  queryClient.invalidateQueries({
                    queryKey: getListMagnetsQueryKey(),
                  }),
                ]);
                toast.success("Photo added");
              } catch (err) {
                toast.error(
                  getUploadErrorMessage(err, "Failed to upload photo"),
                );
                throw err;
              } finally {
                setIsUploading(false);
              }
            }}
            onDeleteImage={(imageId, isPrimary) => {
              if (isPrimary) {
                toast.error(
                  "Set another photo as primary first, then delete this one.",
                );
                return;
              }
              deleteImageMutation.mutate(
                { id, imageId },
                {
                  onSuccess: () => {
                    void Promise.all([
                      queryClient.invalidateQueries({
                        queryKey: getGetMagnetQueryKey(id),
                      }),
                      queryClient.invalidateQueries({
                        queryKey: getListMagnetsQueryKey(),
                      }),
                    ]);
                    toast.success("Photo removed");
                  },
                  onError: () => toast.error("Failed to delete photo"),
                },
              );
            }}
            onSetPrimary={(imageId) => {
              setPrimaryMutation.mutate(
                { id, imageId },
                {
                  onSuccess: () => {
                    void Promise.all([
                      queryClient.invalidateQueries({
                        queryKey: getGetMagnetQueryKey(id),
                      }),
                      queryClient.invalidateQueries({
                        queryKey: getListMagnetsQueryKey(),
                      }),
                    ]);
                    toast.success("Primary photo updated");
                  },
                  onError: () => toast.error("Failed to update primary photo"),
                },
              );
            }}
            onRelabel={async (imageId, label) => {
              await relabelImageMutation.mutateAsync({
                id,
                imageId,
                data: { label },
              });
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: getGetMagnetQueryKey(id),
                }),
                queryClient.invalidateQueries({
                  queryKey: getListMagnetsQueryKey(),
                }),
              ]);
              toast.success("Label saved");
            }}
          />
        </>
      }
      titleSlot={
        isEditing ? (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Name</Label>
            <div className="flex items-center gap-1">
              <Input
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                className="text-lg font-bold"
                autoFocus
              />
              <button
                type="button"
                title={
                  lockedFields.includes("name")
                    ? "Unlock name (AI can update)"
                    : "Lock name (AI won't update)"
                }
                onClick={() => toggleLockedField("name")}
                className="ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground hover:bg-card-border"
              >
                {lockedFields.includes("name") ? (
                  <Lock className="h-3.5 w-3.5" />
                ) : (
                  <Unlock className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        ) : (
          <h1 className="text-2xl font-bold tracking-tight">{item.name}</h1>
        )
      }
      actions={
        isEditing ? (
          <>
            <Button
              size="sm"
              onClick={saveEdit}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={cancelEdit}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              size="icon"
              onClick={handleRefreshAi}
              disabled={isReanalyzeBusy}
              title="Refresh AI analysis"
              data-testid="button-reanalyze"
            >
              {isReanalyzeBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={enterEdit}
              title="Edit"
              data-testid="button-edit"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  data-testid="button-delete"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this magnet?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes "{item.name}" and all its photos.
                    This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteMutation.mutate({ id })}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid="button-confirm-delete"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )
      }
      heroContent={
        !isEditing && (item.description || item.categories.length > 0) ? (
          <div className="space-y-4">
            {item.description && (
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Description
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </div>
            )}
            {item.categories.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Categories
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {item.categories.map((cat) => (
                    <Badge
                      key={cat.id}
                      variant="secondary"
                      className="font-normal"
                      style={
                        cat.bgColor
                          ? {
                              backgroundColor: cat.bgColor,
                              color: cat.textColor ?? "#fff",
                              border: "none",
                            }
                          : undefined
                      }
                    >
                      {cat.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null
      }
      fields={
        isEditing ? (
          <>
            {/* Description edit with lock toggle */}
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Label className="text-sm font-medium">Description</Label>
                <button
                  type="button"
                  title={
                    lockedFields.includes("description")
                      ? "Unlock (AI can update)"
                      : "Lock (AI won't update)"
                  }
                  onClick={() => toggleLockedField("description")}
                  className="ml-1 grid h-6 w-6 place-items-center rounded-full bg-muted text-muted-foreground hover:bg-card-border"
                >
                  {lockedFields.includes("description") ? (
                    <Lock className="h-3 w-3" />
                  ) : (
                    <Unlock className="h-3 w-3" />
                  )}
                </button>
              </div>
              <Textarea
                value={draft.description}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
                rows={4}
                className="w-full"
              />
            </div>

            {/* Categories */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Categories</p>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() =>
                      setSelectedCategoryIds((prev) =>
                        prev.includes(cat.id)
                          ? prev.filter((x) => x !== cat.id)
                          : [...prev, cat.id],
                      )
                    }
                    className={cn(
                      "rounded-full px-3 py-1 text-sm transition-colors",
                      selectedCategoryIds.includes(cat.id)
                        ? "bg-primary text-primary-foreground"
                        : "border bg-muted hover:bg-muted/80",
                    )}
                    style={
                      selectedCategoryIds.includes(cat.id) && cat.bgColor
                        ? {
                            backgroundColor: cat.bgColor,
                            color: cat.textColor ?? "#fff",
                          }
                        : undefined
                    }
                  >
                    {cat.name}
                  </button>
                ))}
                {categories.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No categories yet.{" "}
                    <a href="/magnets/categories" className="underline">
                      Create one
                    </a>
                  </p>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <CollectionDetailField
              label="Name"
              value={item.name}
              locked={lockedFields.includes("name")}
              onToggleLock={() => toggleLockedField("name")}
            />
            <CollectionDetailField
              label="Description"
              value={item.description ?? "—"}
              empty={!item.description}
              locked={lockedFields.includes("description")}
              onToggleLock={() => toggleLockedField("description")}
            />
          </>
        )
      }
    />
  );
}
