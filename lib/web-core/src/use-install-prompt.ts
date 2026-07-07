import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Captures the browser's `beforeinstallprompt` event so you can trigger
 * the native "Add to home screen" prompt programmatically.
 *
 * - Returns `isPromptAvailable: true` only when the browser has an
 *   unshown install prompt and the user hasn't dismissed the banner this session.
 * - `prompt()` shows the native dialog.
 * - `dismiss()` hides the banner until the next page load.
 */
export function useInstallPrompt(): {
  isPromptAvailable: boolean;
  prompt: () => Promise<void>;
  dismiss: () => void;
} {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Already installed (standalone / minimal-ui display mode) — no banner needed.
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(display-mode: standalone)").matches
    ) {
      return;
    }

    // User already dismissed the banner this session.
    try {
      if (sessionStorage.getItem("pwa-install-dismissed") === "1") {
        setDismissed(true);
        return;
      }
    } catch {
      // sessionStorage blocked (private mode etc.) — ignore
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setDeferredPrompt(null);
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
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem("pwa-install-dismissed", "1");
    } catch {
      // ignore
    }
    setDismissed(true);
    setDeferredPrompt(null);
  }, []);

  return {
    isPromptAvailable: !!deferredPrompt && !dismissed,
    prompt,
    dismiss,
  };
}
