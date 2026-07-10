import { type ReactNode } from "react";
import { AssistantWidget } from "@/travels/components/assistant/AssistantWidget";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AssistantWidget />
    </>
  );
}
