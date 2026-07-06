import { useRef, useState } from "react";
import { toast } from "sonner";
import { useElaineChat } from "@workspace/elaine-ui";
import {
  useCheckMagnet,
  type MagnetCheckResult,
} from "@workspace/api-client-react";

/**
 * Wraps the shared Elaine chat hook with the travels magnet-check feature.
 * This lives in the standalone Elaine app (not the shared `elaine-ui`
 * package) since magnet check is a travels-domain feature that only makes
 * sense in the full "SUPER AI Agent" chat surface, not the lightweight
 * floating widget used across every app.
 */
export function useFullChat({ active }: { active: boolean }) {
  const chat = useElaineChat({ appId: "elaine", active });

  const [magnetPreview, setMagnetPreview] = useState<string | null>(null);
  const [magnetResult, setMagnetResult] = useState<MagnetCheckResult | null>(
    null,
  );
  const magnetFileRef = useRef<HTMLInputElement>(null);
  const checkMagnet = useCheckMagnet({
    mutation: {
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Check failed"),
    },
  });

  function handleMagnetFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMagnetPreview(URL.createObjectURL(file));
    setMagnetResult(null);
    const formData = new FormData();
    formData.append("photo", file);
    checkMagnet.mutate(formData, { onSuccess: setMagnetResult });
  }

  function dismissMagnetCheck() {
    setMagnetPreview(null);
    setMagnetResult(null);
    checkMagnet.reset();
  }

  function handleNewConversation() {
    setMagnetPreview(null);
    setMagnetResult(null);
    checkMagnet.reset();
    chat.handleNewConversation();
  }

  function handleSend(overrideText?: string) {
    setMagnetPreview(null);
    setMagnetResult(null);
    checkMagnet.reset();
    return chat.handleSend(overrideText);
  }

  return {
    ...chat,
    magnetPreview,
    magnetResult,
    checkMagnet,
    magnetFileRef,
    handleMagnetFileChange,
    dismissMagnetCheck,
    handleNewConversation,
    handleSend,
  };
}

export type FullChat = ReturnType<typeof useFullChat>;
