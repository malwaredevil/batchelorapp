import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateQuiltingCategory,
  getListQuiltingCategoriesQueryKey,
  type QuiltingCategory,
} from "@workspace/api-client-react";
import { CategoryTagSelector } from "@workspace/collection-ui";
import { toast } from "sonner";
import { normalizeCollectionTag as normalizeTagInput } from "@workspace/web-core/collection-text";

export { normalizeTagInput };

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
