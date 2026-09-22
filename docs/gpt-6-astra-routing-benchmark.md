# GPT-6 Astra routing benchmark

Date: 2026-09-22

## Decision

Use GPT-6 Astra only for Elaine's direct OpenAI `reasoning` role and the
OpenAI seat in the two-vendor expert panel.

Keep these existing defaults:

- GPT-5.6 Terra and Luna for direct OpenAI balanced and fast roles
- the fast OpenRouter chat model for real-time AgentPhone voice
- Gemini 2.5 Flash for fast and smart vision
- Perplexity Sonar for research
- OpenAI `text-embedding-3-small` for text embeddings
- Jina CLIP v2 for visual embeddings
- Voyage `rerank-2.5` for reranking
- the existing Anthropic/OpenAI fusion panel, which is a separate expensive
  escalation path

The owner global configuration remains the no-deploy rollback mechanism. A
timestamp-gated one-time migration replaces only the two exact pre-rollout
legacy defaults in an older config row; later owner edits remain authoritative.
A model change also invalidates retained Responses state because the stored
response model must match the configured model before the response ID is
reused.

## Compatibility checks

Live provider probes used the exact production model identifiers:

| Provider path               | Model                | Result                                     |
| --------------------------- | -------------------- | ------------------------------------------ |
| OpenAI Responses            | `gpt-6-astra`        | HTTP 200; strict JSON Schema output passed |
| OpenRouter Chat Completions | `openai/gpt-6-astra` | HTTP 200; JSON output passed               |

Astra supports the production features used by these routes: Responses API,
Chat Completions, streaming, function calling, structured output, tools, and
image input. It is not assigned to real-time voice.

## Single-sample latency and cost probe

The same short structured decision prompt was sent to each model. This is a
compatibility and order-of-magnitude check, not a statistically significant
performance study.

| Route            | Model                |  Latency |         Tokens | Reported or estimated cost |
| ---------------- | -------------------- | -------: | -------------: | -------------------------: |
| OpenAI Responses | `gpt-5.6-sol`        | 4,000 ms | 59 in / 19 out |                   baseline |
| OpenAI Responses | `gpt-6-astra`        | 4,079 ms | 59 in / 19 out |  about 5x the Sol baseline |
| OpenRouter       | `openai/gpt-5.1`     | 1,573 ms | 22 in / 22 out |                  $0.000245 |
| OpenRouter       | `openai/gpt-6-astra` | 3,558 ms | 22 in / 19 out |                  $0.001158 |

Published Astra pricing at the time of the check was approximately $10 per
million input tokens and $50 per million output tokens. The materially higher
cost, and higher OpenRouter latency in this sample, argue against a blanket
upgrade of vision, research, embeddings, reranking, voice, or routine fallback
lanes.

## Expansion criteria

Do not expand Astra into another lane based on availability alone. Require a
representative benchmark showing a meaningful quality improvement, acceptable
latency, and an explicit cost budget for that lane.
