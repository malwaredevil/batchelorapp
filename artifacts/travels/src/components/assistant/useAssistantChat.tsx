import { useRef, useState } from "react";
import { toast } from "sonner";
import { useElaineChat } from "@workspace/elaine-ui";
import {
  useCheckMagnet,
  type MagnetCheckResult,
} from "@workspace/api-client-react";

/**
 * Travels-specific wrapper around the shared Elaine chat hook, adding the
 * magnet-check feature — deliberately kept out of the shared
 * `@workspace/elaine-ui` package since it's travels-only. Both the floating
 * widget and the full-screen chat page use this so they get identical tool
 * access (actions, magnet check, streaming, confirmations).
 */
export function useAssistantChat({ active }: { active: boolean }) {
  const chat = useElaineChat({ appId: "travels", active });

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

export type AssistantChat = ReturnType<typeof useAssistantChat>;
