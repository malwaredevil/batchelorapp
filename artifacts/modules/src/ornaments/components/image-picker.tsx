import { useMemo } from "react";
import { ImagePicker as SharedImagePicker } from "@workspace/image-capture";
import { cn } from "@/lib/utils";
import {
  STANDARD_IMAGE_UPLOAD,
  validateClientUpload,
} from "@workspace/upload-policy";
import { toast } from "sonner";

interface ImagePickerProps {
  value?: Blob | string | null;
  onChange: (file: Blob | null) => void;
  className?: string;
}

/**
 * Ornament form adapter for the shared camera/upload picker. The domain keeps
 * its existing form value contract while all collection apps share the same
 * capture, preview, replace, remove, accessibility, and upload-policy UI.
 */
export function ImagePicker({ value, onChange, className }: ImagePickerProps) {
  const file = useMemo(() => {
    if (value instanceof File) return value;
    if (value instanceof Blob) {
      return new File([value], "ornament-photo", {
        type: value.type || "image/jpeg",
      });
    }
    return null;
  }, [value]);

  function handleSelect(selected: File | null) {
    if (!selected) {
      onChange(null);
      return;
    }
    const validation = validateClientUpload(selected, STANDARD_IMAGE_UPLOAD);
    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }
    onChange(selected);
  }

  return (
    <div className={cn("w-full", className)}>
      <SharedImagePicker file={file} onSelect={handleSelect} />
    </div>
  );
}
