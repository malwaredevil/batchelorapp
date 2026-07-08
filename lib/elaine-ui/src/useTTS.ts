import { useState, useRef, useCallback, useEffect } from "react";

const STORAGE_KEY = "elaine-tts-enabled";
const VOICE_STORAGE_KEY = "elaine-tts-voice-uri";
const RATE_STORAGE_KEY = "elaine-tts-rate";

const MIN_RATE = 0.5;
const MAX_RATE = 2;
const DEFAULT_RATE = 1;
const PREVIEW_TEXT = "Hi, I'm Elaine.";

/** Sentinel used as the `previewingVoiceURI` value while previewing the browser default voice (distinct from `null`, which means "no preview in flight"). */
export const DEFAULT_VOICE_PREVIEW_KEY = "__default__";

export interface TTSState {
  /** Whether the user has spoken replies turned on (persisted in localStorage). */
  enabled: boolean;
  /** False on browsers without SpeechSynthesis support. */
  isSupported: boolean;
  /** True while the browser is actively speaking an utterance. */
  isSpeaking: boolean;
  /** All voices the browser/OS has installed (may be empty until the browser loads them async). */
  voices: SpeechSynthesisVoice[];
  /** The `voiceURI` of the user's preferred voice, or `null` for the browser default. */
  selectedVoiceURI: string | null;
  /** Speaking rate (0.5–2), persisted in localStorage. 1 is normal speed. */
  rate: number;
  /** Flips `enabled` and persists the new value; stops any in-flight speech when turning off. */
  toggle: () => void;
  /** Sets and persists the preferred voice. Pass `null` to use the browser default. */
  setSelectedVoiceURI: (voiceURI: string | null) => void;
  /** Sets and persists the speaking rate (clamped to 0.5–2). */
  setRate: (rate: number) => void;
  /** Speaks the given text aloud. No-ops if TTS is unsupported or disabled. */
  speak: (text: string) => void;
  /** Immediately stops any in-flight or queued speech. */
  stop: () => void;
  /**
   * The voice currently being previewed, or `null` if no preview is playing.
   * Uses `DEFAULT_VOICE_PREVIEW_KEY` to represent the browser default voice.
   */
  previewingVoiceURI: string | null;
  /**
   * Speaks a short sample phrase using the given voice (or the browser
   * default, when `voiceURI` is `null`) at the current rate — regardless of
   * the `enabled` toggle, so users can preview before turning TTS on.
   * Starting a new preview stops any in-flight one.
   */
  previewVoice: (voiceURI: string | null) => void;
  /**
   * The speaking rate currently being previewed, or `null` if no rate
   * preview is playing. Mutually exclusive with `previewingVoiceURI` — only
   * one preview (voice or rate) plays at a time.
   */
  previewingRate: number | null;
  /**
   * Speaks the sample phrase at the given rate using the currently selected
   * voice — regardless of the `enabled` toggle, so users can hear how a
   * speed sounds before picking it. Starting a new preview stops any
   * in-flight one (including a voice preview).
   */
  previewRate: (rate: number) => void;
}

function readStoredEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function readStoredVoiceURI(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(VOICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readStoredRate(): number {
  if (typeof window === "undefined") return DEFAULT_RATE;
  try {
    const raw = localStorage.getItem(RATE_STORAGE_KEY);
    if (!raw) return DEFAULT_RATE;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_RATE;
    return Math.min(MAX_RATE, Math.max(MIN_RATE, parsed));
  } catch {
    return DEFAULT_RATE;
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
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURIState] = useState<string | null>(
    readStoredVoiceURI,
  );
  const [rate, setRateState] = useState<number>(readStoredRate);
  const [previewingVoiceURI, setPreviewingVoiceURI] = useState<string | null>(
    null,
  );
  const [previewingRate, setPreviewingRate] = useState<number | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // The voice list loads asynchronously in most browsers (fires
  // `voiceschanged` once the OS/browser voice catalog is ready).
  useEffect(() => {
    if (!isSupported) return;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, [isSupported]);

  const stop = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setIsSpeaking(false);
    setPreviewingVoiceURI(null);
    setPreviewingRate(null);
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

  const setSelectedVoiceURI = useCallback((voiceURI: string | null) => {
    setSelectedVoiceURIState(voiceURI);
    try {
      if (voiceURI) {
        localStorage.setItem(VOICE_STORAGE_KEY, voiceURI);
      } else {
        localStorage.removeItem(VOICE_STORAGE_KEY);
      }
    } catch {
      // Preference just won't persist across sessions.
    }
  }, []);

  const setRate = useCallback((next: number) => {
    const clamped = Math.min(MAX_RATE, Math.max(MIN_RATE, next));
    setRateState(clamped);
    try {
      localStorage.setItem(RATE_STORAGE_KEY, String(clamped));
    } catch {
      // Preference just won't persist across sessions.
    }
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
      utterance.rate = rate;
      if (selectedVoiceURI) {
        const match = window.speechSynthesis
          .getVoices()
          .find((v) => v.voiceURI === selectedVoiceURI);
        if (match) utterance.voice = match;
      }
      utterance.onstart = () => {
        setIsSpeaking(true);
        setPreviewingVoiceURI(null);
      };
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [isSupported, enabled, rate, selectedVoiceURI],
  );

  const previewVoice = useCallback(
    (voiceURI: string | null) => {
      if (!isSupported) return;

      // Starting a new preview stops any in-flight speech (a reply being
      // read aloud, or a previous preview).
      window.speechSynthesis.cancel();

      const previewKey = voiceURI ?? DEFAULT_VOICE_PREVIEW_KEY;
      const utterance = new SpeechSynthesisUtterance(PREVIEW_TEXT);
      utterance.rate = rate;
      if (voiceURI) {
        const match = window.speechSynthesis
          .getVoices()
          .find((v) => v.voiceURI === voiceURI);
        if (match) utterance.voice = match;
      }
      utterance.onstart = () => {
        setPreviewingVoiceURI(previewKey);
        setPreviewingRate(null);
        setIsSpeaking(true);
      };
      utterance.onend = () => {
        setPreviewingVoiceURI(null);
        setIsSpeaking(false);
      };
      utterance.onerror = () => {
        setPreviewingVoiceURI(null);
        setIsSpeaking(false);
      };
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [isSupported, rate],
  );

  const previewRate = useCallback(
    (previewRateValue: number) => {
      if (!isSupported) return;

      // Starting a new preview stops any in-flight speech (a reply being
      // read aloud, a voice preview, or a previous rate preview).
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(PREVIEW_TEXT);
      utterance.rate = previewRateValue;
      if (selectedVoiceURI) {
        const match = window.speechSynthesis
          .getVoices()
          .find((v) => v.voiceURI === selectedVoiceURI);
        if (match) utterance.voice = match;
      }
      utterance.onstart = () => {
        setPreviewingRate(previewRateValue);
        setPreviewingVoiceURI(null);
        setIsSpeaking(true);
      };
      utterance.onend = () => {
        setPreviewingRate(null);
        setIsSpeaking(false);
      };
      utterance.onerror = () => {
        setPreviewingRate(null);
        setIsSpeaking(false);
      };
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [isSupported, selectedVoiceURI],
  );

  // Stop and clean up if the component unmounts while speaking.
  useEffect(() => {
    return () => {
      if (isSupported) window.speechSynthesis.cancel();
    };
  }, [isSupported]);

  return {
    enabled,
    isSupported,
    isSpeaking,
    voices,
    selectedVoiceURI,
    rate,
    toggle,
    setSelectedVoiceURI,
    setRate,
    speak,
    stop,
    previewingVoiceURI,
    previewVoice,
    previewingRate,
    previewRate,
  };
}
