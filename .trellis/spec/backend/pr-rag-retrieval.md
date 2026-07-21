# PR Knowledge-Base Hybrid Retrieval (RAG)

## Scenario: hybrid retrieval pipeline (lexical BM25 + optional vector + RRF)

### 1. Scope / Trigger

- Trigger: settings/env wiring (`PR_EMBEDDING_*`), retrieval API contract, `knowledge_embeddings` usage.
- Files: `src/lib/pr/rag.ts`, `src/lib/pr/rag-lexical.ts`, `src/lib/pr/embeddings.ts`,
  `scripts/backfill-knowledge-embeddings.ts`, eval wiring in `scripts/eval/`.

### 2. Signatures

```typescript
// rag.ts — public API is frozen; consumers (providers/knowledge.ts, context.ts) must not change
retrieveKnowledge(query: string, limit = 4): Promise<KnowledgeContext[]>
ingestKnowledgeDocument(input): Promise<{ documentId: string; chunks: number; embedded: number }>

// embeddings.ts
getEmbeddingConfig(): Promise<EmbeddingConfig | null>   // null = vector path disabled
embedTexts(texts: string[], config?: EmbeddingConfig): Promise<number[][]>
cosineSimilarity(a: number[], b: number[]): number       // dims mismatch -> 0 (not truncation)

// rag-lexical.ts — pure functions, single-slot index cache
lexicalTopK(chunks, cacheKey, query, topK)               // cacheKey = `${count}:${maxCreatedAt}:${maxChunkId}`
```

- Backfill CLI: `bun run scripts/backfill-knowledge-embeddings.ts` — exit 0 ok / 1 unconfigured / 2 some batches failed (idempotent, rerun to resume).

### 3. Contracts

- Settings keys (admin settings, resolved via `getRuntimeSettings()` = env + config-DB merge, values trimmed):
  `PR_EMBEDDING_API_KEY` (secret, required), `PR_EMBEDDING_MODEL` (required), `PR_EMBEDDING_BASE_URL` (optional, empty = official OpenAI).
  Vector path is enabled iff KEY **and** MODEL are present.
- `knowledge_embeddings` row: `{ chunkId, provider: 'openai-compatible', model, vectorJson: JSON number[] }`.
  Retrieval filters rows by exact `model` match — changing the model invalidates old vectors until backfill reruns.
- Retrieval log (`rag_retrieval_logs`): `queryPlanJson = { mode: 'lexical'|'hybrid', queryTokens, embeddingModel?, rrfK: 60, limit, lexicalCandidates, vectorCandidates }`;
  `scoresJson = [{ id, lexical?, vector?, rrf }]`. `embeddingModel` present while `mode='lexical'` ⇒ "configured but degraded".

### 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| KEY/MODEL missing | pure lexical, `mode=lexical`, no `embeddingModel` in log |
| embedding API error / timeout (3s, no retry) | warn + degrade to lexical for this call; never throws to consumer |
| no vector rows for current model | skip query embedding entirely (saves the API call), `mode=lexical` |
| vector dim mismatch (dirty row / model race) | `cosineSimilarity` returns 0 → filtered by `VECTOR_MIN_COSINE (0.35, bge-calibrated)` |
| ingest embedding failure | chunks still persisted; `embedded: 0`; backfill script repairs later |
| settings store down | `getEmbeddingConfig().catch(() => null)` → lexical |

### 5. Good/Base/Bad Cases

- Good: 「跑完膝盖有点疼」→ BM25 top-1 hits knee-injury doc credential-free (shared 2-grams).
- Base: zero-overlap paraphrase (「怎么练才能后半程不掉速?」) → lexical candidates = 0; only the vector path can hit; eval marks such cases `requiresEmbedding`.
- Bad: storing embeddings without `encoding_format: 'float'` → some OpenAI-compatible gateways ignore the SDK's default base64 request and the SDK mangles float arrays into empty vectors (silent `"[]"` rows, recall dead).

### 6. Tests Required

- Deterministic smoke (no credentials, isolated `file:` DB): ingest eval `KNOWLEDGE_DOCS` → assert lexical-tier queries hit their target doc top-1, semantic-tier query has 0 lexical candidates, >200-chunk corpus still retrieves oldest chunk, log `mode='lexical'`.
- Eval: `kn/retrieval` lexical-tier cases must pass credential-free; `requiresEmbedding` cases auto-skip when `getEmbeddingConfig()` is null (skip is reported, not failed).

### 7. Wrong vs Correct

#### Wrong

```typescript
// 1. Feature gate in a script checks raw env — app layer merges env + config DB
if (!process.env.PR_EMBEDDING_API_KEY) skip()
// 2. Re-reading settings inside the helper — TOCTOU: model can change between reads,
//    vectors get stored under the wrong model label / compared cross-model
const vectors = await embedTexts(texts) // helper re-resolves config internally
// 3. SDK default encoding
await client.embeddings.create({ model, input })
```

#### Correct

```typescript
// 1. Same source + same strength as the app layer
if (!(await getEmbeddingConfig())) skip()
// 2. Resolve config once, pass it down
const config = await getEmbeddingConfig()
const vectors = await embedTexts(texts, config)
// 3. Explicit float — widest gateway compatibility
await client.embeddings.create({ model, input, encoding_format: 'float' })
```
