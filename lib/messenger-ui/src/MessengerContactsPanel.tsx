import { Loader2 } from "lucide-react";
import { useListHouseholdMembers } from "@workspace/api-client-react";

interface MessengerContactsPanelProps {
  onSelect: (prefill: string) => void;
}

const ELAINE_ENTRY = { id: -1, displayName: "Elaine", email: "" };

export function MessengerContactsPanel({
  onSelect,
}: MessengerContactsPanelProps) {
  const { data: members = [], isLoading } = useListHouseholdMembers();
  const all = [ELAINE_ENTRY, ...members];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#fff",
      }}
    >
      <div
        style={{
          padding: "10px 16px 8px",
          borderBottom: "1px solid #f3f4f6",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "#6b7280",
            fontWeight: 500,
          }}
        >
          Send a message to…
        </p>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {isLoading ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              padding: 32,
            }}
          >
            <Loader2
              size={20}
              style={{ animation: "spin 1s linear infinite", color: "#9ca3af" }}
            />
          </div>
        ) : (
          all.map((m, idx) => {
            const isElaine = m.id === -1;
            const name = m.displayName ?? m.email.split("@")[0] ?? "?";
            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 16px",
                  borderBottom:
                    idx < all.length - 1 ? "1px solid #f9fafb" : "none",
                  cursor: "default",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#f9fafb")
                }
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: isElaine
                      ? "linear-gradient(135deg, #7c3aed, #4f46e5)"
                      : "linear-gradient(135deg, #3b82f6, #2563eb)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: isElaine ? 14 : 15,
                    fontWeight: 700,
                    flexShrink: 0,
                    userSelect: "none",
                  }}
                >
                  {isElaine ? "✦" : (name[0]?.toUpperCase() ?? "?")}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#111827",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {name}
                  </div>
                  {isElaine ? (
                    <div style={{ fontSize: 11, color: "#7c3aed" }}>
                      AI Assistant · @elaine
                    </div>
                  ) : (
                    m.email && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "#9ca3af",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {m.email}
                      </div>
                    )
                  )}
                </div>

                <button
                  onClick={() => onSelect(`@${name} `)}
                  style={{
                    background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "5px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  Message
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
