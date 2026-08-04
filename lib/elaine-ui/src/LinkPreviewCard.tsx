import { useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  useGetLinkPreview,
  getGetLinkPreviewQueryKey,
} from "@workspace/api-client-react";

interface LinkPreviewCardProps {
  url: string;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function LinkPreviewCard({ url }: LinkPreviewCardProps) {
  const { data } = useGetLinkPreview(
    { url },
    {
      query: {
        queryKey: getGetLinkPreviewQueryKey({ url }),
        staleTime: 5 * 60 * 1000,
      },
    },
  );
  // Third-party OG-image/favicon URLs can 404 or block hotlinking after the
  // fact even though the preview metadata itself resolved fine — fall back
  // to the text-only card instead of leaving a broken-image icon.
  const [imgFailed, setImgFailed] = useState(false);

  if (!data || (!data.title && !data.description && !data.imageUrl))
    return null;

  const showImage = !!data.imageUrl && !imgFailed;

  const domain = getDomain(url);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block mt-1.5 rounded-xl overflow-hidden no-underline text-inherit border border-border hover:opacity-85 transition-opacity"
      style={{ borderLeft: "3px solid hsl(var(--primary))" }}
    >
      {showImage && (
        <img
          src={data.imageUrl!}
          alt={data.title ?? ""}
          className="w-full object-cover block"
          style={{ height: 130 }}
          onError={() => setImgFailed(true)}
        />
      )}
      <div className="px-3 py-2 bg-background">
        <div className="flex items-center gap-1 mb-0.5 text-primary font-semibold uppercase tracking-wide text-[10px]">
          <ExternalLink size={9} />
          {domain}
        </div>
        {data.title && (
          <div className="text-[13px] font-semibold text-foreground leading-snug line-clamp-2">
            {data.title}
          </div>
        )}
        {data.description && (
          <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
            {data.description}
          </div>
        )}
      </div>
    </a>
  );
}
