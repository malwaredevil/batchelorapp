# OpenAI Responses rollout

This programme adds a centralized direct-OpenAI lane without removing the
existing OpenRouter implementations.

## Runtime routing

- Elaine's primary authenticated web chat uses the configured reasoning
  model through the Responses API when `OPENAI_API_KEY` and
  `enableOpenAIResponses` are present. The code default is `gpt-6.2-astra`.
- Selected high-value app workflows use the configured reasoning, balanced,
  or fast role when `enableOpenAIAppWorkflows` is enabled. The default
  balanced and fast models are `gpt-6.2-sol` and `gpt-6-luna`.
- Provider failures fall back to the existing OpenRouter implementation when
  `enableOpenAIResponsesFallback` is enabled.
- Restricted AgentPhone, inbound email, SMS, and Slack turns attempt the
  reasoning-role Responses path before their existing bounded OpenRouter
  fallback. Real-time voice remains on the fast OpenRouter chat model.
- Voyage, Jina, Perplexity/web search, Apify, Google APIs, and deterministic
  extraction/ranking algorithms remain specialized evidence sources.
- Corroborated web search uses the fast Responses role to compare two
  summaries when OpenAI app workflows are enabled. The comparison does not
  store provider conversation state or retry, and uses the separate
  `web_search.agreement_timeout_ms` deadline (2.5 seconds by default). When
  that comparison fails, both sources are presented as unverified. The
  existing OpenRouter comparison is selected only when OpenAI app workflows
  are unavailable at the start of the check.

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

For GPT‑6.2, the initial developer policy is the first input item. Continued
rounds keep the existing response pointer and include only new input and
current-turn instructions, rather than rewriting the saved prefix. Older
configured models retain their original request shape.

The response ID is never returned to a frontend or included in general logs.
No chain-of-thought or raw reasoning content is requested or persisted.

## Rollback

The owner can disable app workflows independently or disable Responses
entirely from Elaine's Global Configuration page. Disabling Responses requires
no database rollback; local conversation history continues to work through
OpenRouter. The nullable state columns are tracked for later review in cleanup
issue #376.

For a model-only rollback, restore `gpt-6-astra` and `gpt-6.1-sol` in
Elaine’s Global Configuration. Changing a model invalidates only its retained
provider pointer, not the saved conversation.

## Deployment order

1. Apply additive migration `0006_openai_responses_state.sql`.
2. Verify the three nullable columns and database security advisors.
3. Confirm `OPENAI_API_KEY` is available to the deployed Repl.
4. Merge and pull the application PR.
5. Smoke-test a normal Elaine answer, a household read, a confirmation-gated
   action, a tool-backed research turn, and an OpenRouter rollback.

### Activate GPT‑6.2 on an existing installation

The new model defaults do not overwrite saved owner choices. In this workspace,
development and published code can use the same database, so applying an
automatic startup migration could switch models on the older published code
before it supports the GPT‑6.2 request shape.

After publishing the compatible server, set **OpenAI Reasoning** to
`gpt-6.2-astra` and **OpenAI Balanced** to `gpt-6.2-sol` together in Elaine’s
owner-only Global Configuration, if the installation still has the previous
defaults. Leave intentional model overrides, voice, and OpenRouter fallback
models intact. Then repeat the continued-conversation and tool smoke tests.

The owner-only `/api/elaine/diagnostics` response reports aggregate runtime and
state counts. It contains no prompts, memory values, tool payloads, response
IDs, or provider error messages.
