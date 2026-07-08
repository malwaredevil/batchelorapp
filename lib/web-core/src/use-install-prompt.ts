import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "pwa-install-dismissed-until";
const INSTALLED_KEY = "pwa-install-installed";
const DISMISS_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isPermanentlySuppressed(): boolean {
  try {
    if (localStorage.getItem(INSTALLED_KEY) === "1") {
      return true;
    }

    const dismissedUntil = localStorage.getItem(DISMISSED_KEY);
    if (dismissedUntil && Date.now() < Number(dismissedUntil)) {
      return true;
    }
  } catch {
    // localStorage blocked (private mode etc.) — ignore, fall through to showing the banner
  }

  return false;
}

/**
 * Captures the browser's `beforeinstallprompt` event so you can trigger
 * the native "Add to home screen" prompt programmatically.
 *
 * - Returns `isPromptAvailable: true` only when the browser has an
 *   unshown install prompt and the user hasn't dismissed the banner
 *   within the last 30 days or already installed the app.
 * - `prompt()` shows the native dialog.
 * - `dismiss()` hides the banner for 30 days (persisted in `localStorage`).
 * - A successful install (`appinstalled` event) permanently suppresses the banner.
 */
export function useInstallPrompt(): {
  isPromptAvailable: boolean;
  prompt: () => Promise<void>;
  dismiss: () => void;
} {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [suppressed, setSuppressed] = useState(false);

  useEffect(() => {
    // Already installed (standalone / minimal-ui display mode) — no banner needed.
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(display-mode: standalone)").matches
    ) {
      return;
    }

    // User already dismissed the banner within the last 30 days, or already installed.
    if (isPermanentlySuppressed()) {
      setSuppressed(true);
      return;
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      try {
        localStorage.setItem(INSTALLED_KEY, "1");
      } catch {
        // ignore
      }
      setDeferredPrompt(null);
      setSuppressed(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const prompt = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      try {
        localStorage.setItem(INSTALLED_KEY, "1");
      } catch {
        // ignore
      }
      setDeferredPrompt(null);
      setSuppressed(true);
    }
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(
        DISMISSED_KEY,
        String(Date.now() + DISMISS_DURATION_MS),
      );
    } catch {
      // ignore
    }
    setSuppressed(true);
    setDeferredPrompt(null);
  }, []);

  return {
    isPromptAvailable: !!deferredPrompt && !suppressed,
    prompt,
    dismiss,
  };
}
