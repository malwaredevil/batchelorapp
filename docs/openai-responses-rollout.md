# OpenAI Responses rollout

This programme adds a centralized direct-OpenAI lane without removing the
existing OpenRouter implementations.

## Runtime routing

- Elaine's primary authenticated web chat uses `gpt-5.6-sol` through the
  Responses API when `OPENAI_API_KEY` and `enableOpenAIResponses` are present.
- Selected high-value app workflows use the configured GPT-5.6 reasoning,
  balanced, or fast role when `enableOpenAIAppWorkflows` is enabled.
- Provider failures fall back to the existing OpenRouter implementation when
  `enableOpenAIResponsesFallback` is enabled.
- Restricted AgentPhone, inbound email, SMS, and Slack turns retain their
  existing bounded OpenRouter path and action exclusions.
- Voyage, Jina, Perplexity/web search, Apify, Google APIs, and deterministic
  extraction/ranking algorithms remain specialized evidence sources.

Only `artifacts/api-server/src/lib/openai-responses.ts` may construct the direct
Responses client. It owns timeout configuration, circuit breaking, state and
cache identifiers, compaction, tool conversion, fallback metrics, and
sanitized logging.

## Conversation state

Each named Elaine conversation may store a nullable last response ID, model,
and update timestamp. The pointer is reused only when it is fresh and from the
same configured model. Local messages and summaries remain authoritative:
Elaine rebuilds once from local history when retained provider state is missing
or expired.

The response ID is never returned to a frontend or included in general logs.
No chain-of-thought or raw reasoning content is requested or persisted.

## Rollback

The owner can disable app workflows independently or disable Responses
entirely from Elaine's Global Configuration page. Disabling Responses requires
no database rollback; local conversation history continues to work through
OpenRouter. The nullable state columns are tracked for later review in cleanup
issue #376.

## Deployment order

1. Apply additive migration `0006_openai_responses_state.sql`.
2. Verify the three nullable columns and database security advisors.
3. Confirm `OPENAI_API_KEY` is available to the deployed Repl.
4. Merge and pull the application PR.
5. Smoke-test a normal Elaine answer, a household read, a confirmation-gated
   action, a tool-backed research turn, and an OpenRouter rollback.

The owner-only `/api/elaine/diagnostics` response reports aggregate runtime and
state counts. It contains no prompts, memory values, tool payloads, response
IDs, or provider error messages.
