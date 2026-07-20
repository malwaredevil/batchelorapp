const KEYFRAMES = `
@keyframes messenger-dot-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.6; }
  30% { transform: translateY(-5px); opacity: 1; }
}
`;

interface TypingIndicatorProps {
  names: string[];
}

export function TypingIndicator({ names }: TypingIndicatorProps) {
  if (names.length === 0) return null;

  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : "Several people are typing";

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "2px 16px 4px",
        }}
      >
        {/* Three bouncing dots */}
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          {([0, 160, 320] as const).map((delay, i) => (
            <span
              key={i}
              style={{
                display: "block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "hsl(var(--muted-foreground))",
                animation: `messenger-dot-bounce 1.1s ease-in-out ${delay}ms infinite`,
              }}
            />
          ))}
        </div>
        {/* Label */}
        <span
          style={{
            fontSize: 11,
            color: "hsl(var(--muted-foreground))",
            fontStyle: "italic",
          }}
        >
          {label}…
        </span>
      </div>
    </>
  );
}
