import { callModel, MODELS } from "./ai-client";

/**
 * Multi-model advice panel for elAIne. When a question calls for expertise,
 * judgment, or a recommendation (as opposed to a fact that's either already
 * known or looked up live — see web-search.ts for that case), relying on a
 * single model's opinion is a coin flip. This asks two independent models
 * from different vendor families the same question in parallel, then merges
 * their answers into one coherent recommendation via a third (cheap) model
 * instead of just concatenating both — a single decisive answer reads far
 * better in a chat bubble than "Model A says X, Model B says Y".
 */

export interface ExpertConsultResult {
  answer: string;
}

const CONSULT_TIMEOUT_MS = 15_000;
const EXPERT_PANEL = [MODELS.ADVISOR, MODELS.EXPERT_PANEL_ALT] as const;

const EXPERT_SYSTEM_PROMPT =
  "You are a knowledgeable, opinionated advisor for a travel-planning assistant app. Give direct, practical, well-reasoned advice or a recommendation in a few sentences to a short paragraph. State an actual opinion or recommendation rather than a wishy-washy non-answer, and briefly say why.";

async function askExpert(
  model: string,
  question: string,
  context?: string,
): Promise<string> {
  const userContent = context
    ? `${question}\n\nRelevant context: ${context}`
    : question;
  const raw = await callModel(model, (client, m) =>
    client.chat.completions.create(
      {
        model: m,
        messages: [
          { role: "system", content: EXPERT_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        max_tokens: 500,
      },
      { timeout: CONSULT_TIMEOUT_MS },
    ),
  );
  return raw.choices[0]?.message?.content?.trim() ?? "";
}

export async function consultExperts(
  question: string,
  context?: string,
): Promise<ExpertConsultResult> {
  const trimmedQuestion = question.trim().slice(0, 500);
  if (!trimmedQuestion) return { answer: "" };
  const trimmedContext = context?.trim().slice(0, 1000) || undefined;

  const settled = await Promise.allSettled(
    EXPERT_PANEL.map((model) =>
      askExpert(model, trimmedQuestion, trimmedContext),
    ),
  );
  const opinions = settled
    .filter(
      (r): r is PromiseFulfilledResult<string> =>
        r.status === "fulfilled" && r.value.length > 0,
    )
    .map((r) => r.value);

  if (opinions.length === 0) return { answer: "" };
  if (opinions.length === 1) return { answer: opinions[0] };

  // Merge independent opinions into one decisive answer instead of just
  // picking or concatenating them. Uses the cheap subagent worker model —
  // synthesizing already-written opinions into a summary is exactly the kind
  // of routine reformatting task that model is used for elsewhere.
  try {
    const merged = await callModel(MODELS.SUBAGENT_WORKER, (client, m) =>
      client.chat.completions.create(
        {
          model: m,
          messages: [
            {
              role: "system",
              content:
                "You merge independent expert opinions into one clear, decisive answer for a travel-planning assistant. You'll be given the same question plus two or more independent opinions on it. Combine them into a single coherent recommendation: where they agree, state it plainly and confidently; where they genuinely disagree, briefly note the tradeoff and still give a clear leaning rather than a non-answer. Keep it to a short paragraph. Never mention that you're merging multiple AI opinions or name any model — just give the resulting advice as Elaine's own answer.",
            },
            {
              role: "user",
              content: `Question: ${trimmedQuestion}\n\n${opinions
                .map((text, i) => `Opinion ${i + 1}:\n${text}`)
                .join("\n\n")}`,
            },
          ],
          max_tokens: 500,
        },
        { timeout: CONSULT_TIMEOUT_MS },
      ),
    );
    const answer = merged.choices[0]?.message?.content?.trim();
    if (answer) return { answer };
  } catch {
    // Merge step failed — fall through to the safe fallback below rather
    // than losing both perfectly good opinions we already have.
  }

  return { answer: opinions[0] };
}
