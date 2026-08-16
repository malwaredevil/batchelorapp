import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateOrnamentCategory,
  getListOrnamentCategoriesQueryKey,
  type OrnamentsCategory as Category,
} from "@workspace/api-client-react";
import { CategoryTagSelector } from "@workspace/collection-ui";
import { toast } from "sonner";

interface TagSelectorProps {
  label?: string;
  allCategories: Category[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  onCreated: (category: Category) => void;
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
  const create = useCreateOrnamentCategory({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: getListOrnamentCategoriesQueryKey(),
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
      onCreate={async (input) => {
        const category = await create.mutateAsync({ data: input });
        toast.success(`Category "${category.name}" created and added.`);
        return category;
      }}
    />
  );
}
