import type { ElaineRequestClass } from "./contracts";
import type { OpenAIResponsesRole } from "../../lib/openai-responses";

export interface StoredElaineResponseState {
  responseId: string | null;
  model: string | null;
  updatedAt: Date | string | null;
}

export function selectElaineOpenAIRole(
  _requestClass: ElaineRequestClass,
): OpenAIResponsesRole {
  // Elaine is a long-lived agent, not a one-shot generation endpoint. Keeping
  // her on one reasoning model preserves previous_response_id continuity
  // across a household thread; switching models by turn complexity would
  // discard retained reasoning precisely when a simple chat becomes an
  // action or research request.
  return "reasoning";
}

export function isReusableElaineResponseState(input: {
  state: StoredElaineResponseState | null;
  expectedModel: string;
  maxAgeDays: number;
  now?: Date;
}): boolean {
  const { state } = input;
  if (!state?.responseId || state.model !== input.expectedModel) return false;
  if (!state.updatedAt) return false;
  const updatedAt =
    state.updatedAt instanceof Date
      ? state.updatedAt
      : new Date(state.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) return false;
  const now = input.now ?? new Date();
  const ageMs = now.getTime() - updatedAt.getTime();
  return ageMs >= 0 && ageMs < input.maxAgeDays * 86_400_000;
}

/**
 * Assistant messages persist citation URLs after an ASCII unit separator so
 * the UI can render them after refresh. That transport metadata is not part
 * of Elaine's prose and should never be fed back to either model provider.
 */
export function stripElaineCitationMetadata(content: string): string {
  return content.split("\x1f", 1)[0] ?? "";
}
