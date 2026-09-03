import type { ReactNode } from "react";
import { GalleryPaginator } from "./GalleryPaginator";

interface GalleryPaginationPairProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  hasResults?: boolean;
  children: ReactNode;
}

/**
 * Keeps collection pagination placement consistent without duplicating the
 * paginator implementation or allowing the two controls to drift apart.
 */
export function GalleryPaginationPair({
  page,
  totalPages,
  onPageChange,
  hasResults = true,
  children,
}: GalleryPaginationPairProps) {
  if (!hasResults || totalPages <= 1) return <>{children}</>;

  return (
    <>
      <GalleryPaginator
        page={page}
        totalPages={totalPages}
        onPageChange={onPageChange}
        className="mb-4"
      />
      {children}
      <GalleryPaginator
        page={page}
        totalPages={totalPages}
        onPageChange={onPageChange}
        className="mt-6"
      />
    </>
  );
}
