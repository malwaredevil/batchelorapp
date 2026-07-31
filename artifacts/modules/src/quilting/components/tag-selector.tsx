import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateQuiltingCategory,
  getListQuiltingCategoriesQueryKey,
  type QuiltingCategory,
} from "@workspace/api-client-react";
import { CategoryTagSelector } from "@workspace/collection-ui";
import { toast } from "sonner";

export function normalizeTagInput(raw: string): string {
  const value = raw
    .replace(
      /[\u201C\u201D\u201E\u201F\u2033\u2036\u275D\u275E\u301D\u301E\u02BA\uFF02″]/g,
      '"',
    )
    .replace(
      /[\u2018\u2019\u201A\u201B\u2032\u2035\u275B\u275C\u02B9\u02BC\uFF07′]/g,
      "'",
    )
    .replace(/[\u2013\u2014\u2015\u2012]/g, "-")
    .replace(/\u2026/g, "...")
    .trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

interface TagSelectorProps {
  label?: string;
  allCategories: QuiltingCategory[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  onCreated: (category: QuiltingCategory) => void;
  disabled?: boolean;
}

export function TagSelector({
  label,
  allCategories,
  selectedIds,
  onToggle,
  onCreated,
  disabled,
}: TagSelectorProps) {
  const queryClient = useQueryClient();
  const create = useCreateQuiltingCategory({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: getListQuiltingCategoriesQueryKey(),
        }),
      onError: () => toast.error("Could not create category."),
    },
  });

  return (
    <CategoryTagSelector
      label={label}
      categories={allCategories}
      selectedIds={selectedIds}
      onToggle={onToggle}
      onCreated={onCreated}
      disabled={disabled}
      normalizeInput={normalizeTagInput}
      enableColorPicker
      onCreate={async (input) => {
        const category = await create.mutateAsync({ data: input });
        toast.success(`Category "${category.name}" created and added.`);
        return category;
      }}
    />
  );
}
