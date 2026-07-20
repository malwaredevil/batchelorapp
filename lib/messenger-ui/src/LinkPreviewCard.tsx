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

  if (!data || (!data.title && !data.description && !data.imageUrl))
    return null;

  const domain = getDomain(url);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "block",
        marginTop: 6,
        borderRadius: 10,
        overflow: "hidden",
        textDecoration: "none",
        color: "inherit",
        background: "hsl(var(--background))",
        border: "1px solid hsl(var(--border))",
        borderLeft: "3px solid hsl(var(--primary))",
        maxWidth: 320,
        transition: "opacity 0.15s",
      }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLAnchorElement).style.opacity = "0.85")
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLAnchorElement).style.opacity = "1")
      }
    >
      {data.imageUrl && (
        <img
          src={data.imageUrl}
          alt={data.title ?? ""}
          style={{
            width: "100%",
            height: 140,
            objectFit: "cover",
            display: "block",
          }}
        />
      )}
      <div style={{ padding: "8px 12px 10px" }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "hsl(var(--primary))",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 3,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <ExternalLink size={9} />
          {domain}
        </div>
        {data.title && (
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "hsl(var(--foreground))",
              lineHeight: 1.35,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {data.title}
          </div>
        )}
        {data.description && (
          <div
            style={{
              fontSize: 11,
              color: "hsl(var(--muted-foreground))",
              marginTop: 3,
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {data.description}
          </div>
        )}
      </div>
    </a>
  );
}
