import { ExternalLink } from "lucide-react";
import {
  useGetLinkPreview,
  getGetLinkPreviewQueryKey,
} from "@workspace/api-client-react";

interface LinkPreviewCardProps {
  url: string;
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

  if (!data || (!data.title && !data.description && !data.imageUrl))
    return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "block",
        marginTop: 6,
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        overflow: "hidden",
        textDecoration: "none",
        color: "inherit",
        background: "#f9fafb",
        maxWidth: 300,
      }}
    >
      {data.imageUrl && (
        <img
          src={data.imageUrl}
          alt={data.title ?? ""}
          style={{
            width: "100%",
            height: 100,
            objectFit: "cover",
            display: "block",
          }}
        />
      )}
      <div style={{ padding: "8px 10px" }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#111827",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {data.title}
        </div>
        {data.description && (
          <div
            style={{
              fontSize: 11,
              color: "#6b7280",
              marginTop: 2,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {data.description}
          </div>
        )}
        <div
          style={{
            fontSize: 10,
            color: "#9ca3af",
            marginTop: 4,
            display: "flex",
            alignItems: "center",
            gap: 3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <ExternalLink size={10} />
          {url}
        </div>
      </div>
    </a>
  );
}
