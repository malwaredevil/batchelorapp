import { useState } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth";

function todayMMDD(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

export function BirthdayBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  if (!user?.birthday) return null;
  if (dismissed) return null;
  if (user.birthday !== todayMMDD()) return null;

  const name = user.displayName ?? user.email.split("@")[0];

  return (
    <div
      role="banner"
      aria-label="Happy Birthday"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background:
          "linear-gradient(135deg, #f97316 0%, #ec4899 50%, #a855f7 100%)",
        color: "#fff",
        padding: "14px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
      }}
    >
      <span style={{ fontSize: "1.5rem", lineHeight: 1 }}>🎂</span>
      <span
        style={{
          fontWeight: 600,
          fontSize: "1.05rem",
          letterSpacing: "0.01em",
        }}
      >
        Happy Birthday, {name}! Wishing you a wonderful day! 🎉
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss birthday banner"
        style={{
          position: "absolute",
          right: "16px",
          top: "50%",
          transform: "translateY(-50%)",
          background: "rgba(255,255,255,0.2)",
          border: "none",
          borderRadius: "50%",
          width: "28px",
          height: "28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "#fff",
          padding: 0,
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
