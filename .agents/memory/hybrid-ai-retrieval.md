---
name: Hybrid AI retrieval pattern (compare endpoints)
description: How pottery/quilting "compare" search fuses text+visual embeddings, reranks, and maps verdicts — and the invariants that must hold.
---

# Hybrid AI retrieval (compare endpoints)

Both apps' `compare` routes follow the same pipeline. Keep them consistent.

**Pipeline:** analyze image (GPT vision) + generate visual embedding (Jina) in parallel
→ text vector lane (`embedding <=> ...`) + visual vector lane (`visual_embedding <=> ...`) in parallel
→ Reciprocal Rank Fusion (`k=60`, keeps the text cosine `textSimilarity` for later use)
→ Voyage rerank (`rerankCandidates`) trims to TOP_K
→ GPT `compareWithMatches` for the final verdict.

**Graceful degradation — required, do not break:**
- No `JINA_API_KEY` → `generateVisualEmbedding()` returns `null`; visual lane stays empty; RRF degrades to text-only. All three "optional" AI keys are nominally required in prod, but the code must not hard-fail when one is missing.
- No `VOYAGE_API_KEY` or rerank error → `rerankCandidates()` returns the input order unchanged.

**Index-mapping invariant (subtle bug source):** pottery's `compareWithMatches` keys `perMatch` by the **sequential array index** of the matches it was given (0-based), NOT by item id. So the readback order must equal the order matches were sent. Maintain one ordering throughout: `orderedRows` (reranked) → `serialized` (built from `orderedRows`) → `verdictInputs` (`serialized.map((_, index) => ...)`) → readback `verdict.perMatch[index]`. Any reshuffle between these steps silently misattributes verdicts.

**Visual embedding write rule:** on reanalyze, only overwrite `visual_embedding` when regeneration returned non-null — `...(visualEmbedding ? { visualEmbedding } : {})`. Otherwise a missing `JINA_API_KEY` would wipe a previously-computed embedding. The column is excluded from the normal select column allowlist (too heavy), so you cannot fall back to the existing row value — the conditional spread is the mechanism.

**Why:** these endpoints are the headline AI feature; the embedding columns are vector(1024) HNSW and are intentionally never returned in API responses or backed up (pgvector unavailable on the Replit built-in DB — regenerate via Bulk Re-analyse).
