import { useState, useRef, useCallback, useEffect } from "react";

// Minimal type declarations for the Web Speech API.
// TypeScript's lib.dom.d.ts may or may not include these depending on
// version and tsconfig; declaring them explicitly keeps the build portable.
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEventPayload extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventPayload) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

interface UseVoiceInputOptions {
  /** Fired for every interim (isFinal=false) and each final (isFinal=true) result. */
  onTranscript: (text: string, isFinal: boolean) => void;
}

export interface VoiceInputState {
  /** True while the browser is actively capturing speech. */
  isListening: boolean;
  /** False on browsers without SpeechRecognition (e.g. Firefox without flag). */
  isSupported: boolean;
  start: () => void;
  stop: () => void;
}

/**
 * Wraps the browser's Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 * No server round-trip — transcription is 100% client-side.
 *
 * Usage:
 *   const voice = useVoiceInput({ onTranscript: (text, isFinal) => ... });
 *   if (!voice.isSupported) { hide mic button }
 */
export function useVoiceInput({ onTranscript }: UseVoiceInputOptions): VoiceInputState {
  const isSupported =
    typeof window !== "undefined" &&
    !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);

  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Keep an always-current ref so the recognition callbacks are never stale.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (!isSupported) return;

    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition!;
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language;

    recognition.onstart = () => setIsListening(true);

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onresult = (event: SpeechRecognitionEventPayload) => {
      let interimText = "";
      let finalText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }

      if (finalText.trim()) {
        onTranscriptRef.current(finalText.trim(), true);
      } else if (interimText.trim()) {
        onTranscriptRef.current(interimText.trim(), false);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [isSupported]);

  // Stop and clean up if the component unmounts while recording.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  return { isListening, isSupported, start, stop };
}
