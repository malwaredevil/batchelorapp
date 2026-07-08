import { useState, useRef, useCallback, useEffect } from "react";

const STORAGE_KEY = "elaine-tts-enabled";

export interface TTSState {
  /** Whether the user has spoken replies turned on (persisted in localStorage). */
  enabled: boolean;
  /** False on browsers without SpeechSynthesis support. */
  isSupported: boolean;
  /** True while the browser is actively speaking an utterance. */
  isSpeaking: boolean;
  /** Flips `enabled` and persists the new value; stops any in-flight speech when turning off. */
  toggle: () => void;
  /** Speaks the given text aloud. No-ops if TTS is unsupported or disabled. */
  speak: (text: string) => void;
  /** Immediately stops any in-flight or queued speech. */
  stop: () => void;
}

function readStoredEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Wraps the browser's Web Speech API (SpeechSynthesis) so Elaine can read
 * her responses aloud. No server round-trip — synthesis is 100% client-side.
 * Mirrors the shape of `useVoiceInput` (options in, small state object out).
 *
 * Usage:
 *   const tts = useTTS();
 *   if (!tts.isSupported) { hide the speaker toggle }
 *   tts.speak(responseText); // only actually speaks if tts.enabled
 */
export function useTTS(): TTSState {
  const isSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const [enabled, setEnabled] = useState<boolean>(readStoredEnabled);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setIsSpeaking(false);
  }, [isSupported]);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage may be unavailable (private browsing, quota) — the
        // toggle still works for the current session, it just won't persist.
      }
      return next;
    });
  }, []);

  // Stop immediately whenever the user disables TTS.
  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  const speak = useCallback(
    (text: string) => {
      if (!isSupported || !enabled) return;
      const clean = text
        .replace(/[*_`#>~]/g, "")
        .replace(/\[\d+\]/g, "")
        .trim();
      if (!clean) return;

      // Cancel anything already queued/speaking before starting the new one.
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [isSupported, enabled],
  );

  // Stop and clean up if the component unmounts while speaking.
  useEffect(() => {
    return () => {
      if (isSupported) window.speechSynthesis.cancel();
    };
  }, [isSupported]);

  return { enabled, isSupported, isSpeaking, toggle, speak, stop };
}
