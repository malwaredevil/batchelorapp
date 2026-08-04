import { useEffect, useRef, useState, useCallback } from "react";
import EmojiPicker, { Theme, EmojiStyle } from "emoji-picker-react";
import { Smile, Loader2, Search } from "lucide-react";
import {
  fetchTrendingGifs,
  searchGifs,
  createGifAttachment,
  type GifResult,
} from "./useGifPicker";

export type PickerTab = "emoji" | "gif";

const GIF_QUICK_CATEGORIES = [
  "Happy",
  "Love",
  "Congrats",
  "Thumbs Up",
  "Sad",
  "Excited",
];

interface PendingAttachmentShape {
  storagePath: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  previewUrl?: string;
}

interface EmojiGifPickerProps {
  initialTab: PickerTab;
  isDark: boolean;
  onClose: () => void;
  onEmojiSelect: (emoji: string) => void;
  onGifAdded: (attachment: PendingAttachmentShape) => void;
}

/**
 * Teams-style tabbed picker for the messenger composer: an Emoji tab (full
 * categorized library, via emoji-picker-react) and a GIF tab (GIPHY trending
 * + search, proxied through our own backend so the API key never reaches the
 * browser). Anchors above the composer toolbar; the caller positions the
 * wrapping container.
 */
export function EmojiGifPicker({
  initialTab,
  isDark,
  onClose,
  onEmojiSelect,
  onGifAdded,
}: EmojiGifPickerProps) {
  const [tab, setTab] = useState<PickerTab>(initialTab);
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [gifQuery, setGifQuery] = useState("");
  const [gifLoading, setGifLoading] = useState(false);
  const [gifError, setGifError] = useState<string | null>(null);
  const [addingGifId, setAddingGifId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const loadTrending = useCallback(() => {
    setGifLoading(true);
    setGifError(null);
    fetchTrendingGifs()
      .then(setGifs)
      .catch((err: Error) => setGifError(err.message))
      .finally(() => setGifLoading(false));
  }, []);

  const runSearch = useCallback((query: string) => {
    setGifLoading(true);
    setGifError(null);
    searchGifs(query)
      .then(setGifs)
      .catch((err: Error) => setGifError(err.message))
      .finally(() => setGifLoading(false));
  }, []);

  useEffect(() => {
    if (tab === "gif" && gifs.length === 0 && !gifLoading && !gifError) {
      loadTrending();
    }
  }, [tab, gifs.length, gifLoading, gifError, loadTrending]);

  const handleGifQueryChange = (value: string) => {
    setGifQuery(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      if (value.trim()) {
        runSearch(value.trim());
      } else {
        loadTrending();
      }
    }, 350);
  };

  const handlePickGif = async (gif: GifResult) => {
    setAddingGifId(gif.id);
    try {
      const attachment = await createGifAttachment(gif);
      onGifAdded({ ...attachment, previewUrl: attachment.url });
      onClose();
    } catch (err) {
      setGifError(err instanceof Error ? err.message : "Could not add GIF");
    } finally {
      setAddingGifId(null);
    }
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: "absolute",
        bottom: "calc(100% + 8px)",
        left: 0,
        width: 320,
        maxWidth: "calc(100vw - 24px)",
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderRadius: 12,
        boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid hsl(var(--border))",
          background: "hsl(var(--muted))",
        }}
      >
        {(
          [
            { key: "emoji", label: "Emoji", icon: <Smile size={14} /> },
            {
              key: "gif",
              label: "GIF",
              icon: <span style={{ fontSize: 11, fontWeight: 700 }}>GIF</span>,
            },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "8px 0",
              background: tab === t.key ? "hsl(var(--card))" : "transparent",
              border: "none",
              borderBottom:
                tab === t.key ? "2px solid #3b82f6" : "2px solid transparent",
              color:
                tab === t.key
                  ? "hsl(var(--foreground))"
                  : "hsl(var(--muted-foreground))",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === "emoji" ? (
        <EmojiPicker
          onEmojiClick={(data) => onEmojiSelect(data.emoji)}
          theme={isDark ? Theme.DARK : Theme.LIGHT}
          emojiStyle={EmojiStyle.NATIVE}
          width="100%"
          height={360}
          previewConfig={{ showPreview: false }}
          searchPlaceHolder="Search emoji"
          lazyLoadEmojis
        />
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: 360,
          }}
        >
          <div style={{ padding: 8 }}>
            <div style={{ position: "relative" }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "hsl(var(--muted-foreground))",
                }}
              />
              <input
                value={gifQuery}
                onChange={(e) => handleGifQueryChange(e.target.value)}
                placeholder="Search GIPHY"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "6px 8px 6px 28px",
                  borderRadius: 8,
                  border: "1px solid hsl(var(--border))",
                  fontSize: 13,
                  outline: "none",
                  background: "hsl(var(--background))",
                  color: "hsl(var(--foreground))",
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 4,
                flexWrap: "wrap",
                marginTop: 6,
              }}
            >
              {GIF_QUICK_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => {
                    setGifQuery(cat);
                    runSearch(cat);
                  }}
                  style={{
                    fontSize: 11,
                    padding: "3px 8px",
                    borderRadius: 999,
                    border: "1px solid hsl(var(--border))",
                    background: "hsl(var(--background))",
                    color: "hsl(var(--muted-foreground))",
                    cursor: "pointer",
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "0 8px 8px",
            }}
          >
            {gifError && (
              <div
                style={{
                  fontSize: 12,
                  color: "hsl(var(--destructive, 0 84% 60%))",
                  padding: 8,
                  textAlign: "center",
                }}
              >
                {gifError}
              </div>
            )}
            {gifLoading && gifs.length === 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  padding: 24,
                }}
              >
                <Loader2
                  size={20}
                  style={{ animation: "spin 1s linear infinite" }}
                />
              </div>
            )}
            {!gifLoading && !gifError && gifs.length === 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: "hsl(var(--muted-foreground))",
                  padding: 24,
                  textAlign: "center",
                }}
              >
                No GIFs found
              </div>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 6,
              }}
            >
              {gifs.map((gif) => (
                <button
                  key={gif.id}
                  onClick={() => void handlePickGif(gif)}
                  disabled={addingGifId !== null}
                  aria-label={gif.title}
                  style={{
                    position: "relative",
                    padding: 0,
                    border: "none",
                    borderRadius: 8,
                    overflow: "hidden",
                    cursor: addingGifId ? "default" : "pointer",
                    background: "hsl(var(--muted))",
                    aspectRatio: "1 / 1",
                  }}
                >
                  <img
                    src={gif.previewUrl}
                    alt={gif.title}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                      opacity: addingGifId === gif.id ? 0.4 : 1,
                    }}
                  />
                  {addingGifId === gif.id && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Loader2
                        size={18}
                        style={{ animation: "spin 1s linear infinite" }}
                      />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
