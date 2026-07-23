import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { UploadCloud, X, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Must match MAX_UPLOAD_BYTES in lib/upload-validation/src/index.ts
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

interface ImagePickerProps {
  value?: Blob | string | null;
  onChange: (file: Blob | null) => void;
  className?: string;
}

export function ImagePicker({ value, onChange, className }: ImagePickerProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!value) {
      setPreview(null);
      return;
    }

    if (typeof value === "string") {
      setPreview(value);
      return;
    }
    if (value instanceof Blob) {
      const url = URL.createObjectURL(value);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    return;
  }, [value]);

  const handleFile = (file: File | null) => {
    if (!file) {
      onChange(null);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("Photo is too large. Please choose an image under 10 MB.");
      return;
    }
    onChange(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className={cn("relative group", className)}>
      <input
        type="file"
        ref={fileInputRef}
        accept="image/jpeg,image/png,image/webp,image/heic"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFile(e.target.files[0]);
          }
        }}
      />

      {preview ? (
        <div className="relative w-full aspect-square rounded-xl overflow-hidden border border-border bg-muted">
          <img
            src={preview}
            alt="Preview"
            className="w-full h-full object-cover"
          />
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-full backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className="w-full aspect-square flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/30 hover:bg-muted/50 hover:border-primary/50 transition-colors text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="p-3 bg-background rounded-full shadow-sm">
            <UploadCloud className="h-6 w-6" />
          </div>
          <div className="text-center px-4">
            <p className="text-sm font-medium">Add Photo</p>
            <p className="text-xs mt-1">JPEG, PNG or HEIC</p>
          </div>
        </button>
      )}
    </div>
  );
}
