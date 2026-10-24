# DocLens AI — RAG Pipeline Review (2026-10-24)

> A review of the whole RAG pipeline (parse → chunk → profile → retrieve → rerank → generate → cite → verify,
> plus comparison / literature review / gap analysis) against [EXPECTATIONS.md](EXPECTATIONS.md).
> Every finding was checked by reading the source. Fixes were verified with the offline tests and the
> retrieval eval listed in §4. **Not verified here:** PostgreSQL/pgvector end to end (no Docker daemon or
> local database on the review machine) and anything that needs a live Gemini answer (every Gemini call from
> this machine timed out on 2026-10-23, including a one-word prompt).

## 1. Summary

The single-paper Q&A path was already in good shape: it numbers evidence, resolves citations on the server,
verifies claims and discloses failures. The weak points were:

1. **Wrong numbers passed verification.** Claim checks were word-overlap only, and the expectations ask for
   numbers to be kept verbatim. "BLEU 30.1" passed against a passage that says 28.4.
2. **Sentences without citations looked grounded.** The model could write factual sentences with no
   `[Evidence N]` marker, and nothing flagged them.
3. **Multi-paper outputs were not verified at all.** Comparison, literature review and gap analysis resolved
   citation numbers, but never checked that a cited passage supports its sentence or comes from the paper the
   sentence names. That is exactly the "do not attribute results to the wrong study" expectation.
4. **Unverified profile text was fed to synthesis as fact.** Profile items the LLM paraphrased without a
   matching source passage still reached the paper cards, the comparison matrix and the summaries.
5. **Multi-paper tasks could not finish in time.** Reranking cost grew with the number of papers (n × 20
   cross-encoder pairs, about 1.1 s each on CPU), and synthesis used the 60 s Gemini timeout meant for short Q&A.

All five are fixed (§2). The remaining items in §3 are documented with a recommendation; they need a design
decision, a model, or an environment that was not available.

## 2. Findings fixed in this change

| # | Sev | Area | Problem (before) | Fix | Where |
| --- | --- | --- | --- | --- | --- |
| F1 | High | Verification | `claim_supported` used token containment ≥ 0.45 only. A claim with a wrong number shares most words with its passage, so it passed. | `check_claim` also requires **every number in the claim** (normalised: `1,024`→`1024`, `93.2%`→`93.2`; spelled-out numbers in the evidence count) to appear in the cited passage. Digits that are part of a name (`GPT-3`) are ignored. The answer note now says how many claims state numbers missing from their passages. | `rag/verification.py › numbers_in, missing_numbers, check_claim`; `rag/chain.py › build_structured_answer` |
| F2 | High | Q&A honesty | Sentences without any `[Evidence N]` marker were shown as if grounded, as long as the separate `claims` list did not mention them. | Content sentences (≥ 6 content words) without a marker, other than "the evidence does not say…" sentences, are counted. The answer gets a note, and `/ask` returns `uncited_sentences`. | `rag/chain.py`, `rag/schemas.py › StructuredAnswer.uncited_sentences`, `query.py` |
| F3 | Med | Evidence | `EvidencePack` cut each block at 1800 characters, but chunks run to about 2300 (2000 + 300 overlap, plus carried short sections). The model did not see up to about 20 % of a chunk, while verification and the citation window used the full chunk. | The default block size is now `CHUNK_MAX_CHARS + CHUNK_OVERLAP_CHARS + 500` (2800), so the model sees the whole chunk. | `rag/evidence.py` |
| F4 | High | Synthesis | Comparison, literature review and gap analysis never verified sentences. In contradictions, the cited passage's paper title silently replaced the title the LLM wrote, which hid misattributions. | New `SynthesisVerifier` checks each sentence on the raw draft. **Supported:** the cited passages contain its content words and numbers. **Misattributed:** it names a paper by title but cites no passage from that paper. **Uncited:** a content sentence with no marker. Results: `verification` {checked, supported, unsupported, misattributed, uncited, issues[]} on all three outputs, per-section counts in reviews, and a one-line note at the top of the review markdown. Gaps get `support`: `stated` (found in the sources), `inferred` (cited but argued, capped at confidence 0.7) or `ungrounded`. Contradiction positions get `verified` and `attributionMismatch`. | `rag/synthesis.py › SynthesisVerifier`, `research_gaps`, `literature_review`, `compare_papers`; backend passes review `verification` through (`query.service.ts`) |
| F5 | High | Profiles | Ungrounded profile items reached the paper cards in every synthesis prompt, the comparison matrix, the coverage report, the paper summary and the extractive fallbacks. These items were LLM output whose quote/text was not found in the cited chunk at ingest. | Only `grounded` items are used everywhere (`_grounded`). | `rag/synthesis.py` |
| F6 | Med | Citations | Synthesis citations showed the first 600 characters of the chunk, not the passage that supports the sentence (Q&A already used `best_window`). | `_CitationIndex.render/use` pass the citing sentences as a hint, so the shown source is the best-matching window. | `rag/synthesis.py › _CitationIndex` |
| F7 | High | Latency | `balanced_retrieve` reranks once per paper with a 20-candidate pool. A 20-paper review scored about 400 pairs: about 7 min on CPU, inferred from the measured 1.1 s per pair, against a 180 s backend timeout. | Per-task cross-encoder budget `SYNTHESIS_RERANK_BUDGET` (60 pairs) split across papers. When a paper's share is no larger than what is kept, the cross-encoder could only reorder, so it is skipped and fused RRF ranks that paper. `/ask` is unchanged. | `rag/retriever.py › balanced_retrieve, rerank(pool=…)` |
| F8 | Med | Retrieval | The per-paper rerank scored candidates against the first 500 characters of all queries joined together, a blurred query. | Callers pass a real rerank query: the comparison question, the gap topic plus "limitations, open problems and future work", or the user's review topic. | `rag/synthesis.py › gather_evidence`, `rag/retriever.py` |
| F9 | Med | Retrieval | Without a user topic, the literature review prefixed the placeholder "Comprehensive literature review" to all seven retrieval queries, biasing them toward the words "literature review". | Queries use the user's topic only when one is given. | `rag/synthesis.py › literature_review` |
| F10 | High | Latency | `/review` called Gemini through `google.generativeai` with **no timeout**, and reranked 40 candidates. | It now uses the shared bounded client (`get_llm`: `LLM_TIMEOUT_S`, `LLM_MAX_RETRIES`) and the default pool of 20. | `query.py › _call_gemini_direct, _retrieve_and_rerank` |
| F11 | High | Latency | Synthesis prompts (up to 48 evidence blocks, long structured output) used the 60 s Q&A Gemini timeout. Timeouts silently produced the extractive fallback. | `SYNTHESIS_LLM_TIMEOUT_S` (100 s) for the three synthesis calls via `invoke_structured(timeout=…)`; backend `AI_SYNTHESIS_TIMEOUT_MS` (280 s) for `/compare`, `/literature-review`, `/research-gaps`, `/review`, below nginx's 300 s. | `rag/llm.py`, `rag/synthesis.py`, `backend/src/ai-proxy/ai-proxy.service.ts`, compose, `.env.example` |
| F12 | Med | Evaluation | Expectations §6.1 asks for nDCG, but only Recall@5 and MRR@10 were measured. | `eval/retrieval_eval.py` reports `ndcg_at_10` (binary relevance: every chunk containing the gold passage counts). | `ai-service/eval/retrieval_eval.py` |

Tests: `ai-service/rag/test_pipeline_review.py` (13 tests) covers F1–F7, F10 and F11. Results are in §4.

## 3. Open findings (not fixed here)

| # | Sev | Area | Finding | Recommendation |
| --- | --- | --- | --- | --- |
| O1 | High | Verification | Verification is **lexical**. Paraphrased or negated errors that reuse the passage's words ("does not improve" vs "improves") can pass. Numbers are now checked; meaning is not. | Add an entailment (NLI) cross-encoder check per claim, gated by CPU budget. Measure it on a set of hand-labelled claims before trusting it. |
| O2 | High | Abstention | **Partly fixed 2026-10-24**: a BGE-M3 cosine floor (`RETRIEVAL_MIN_SIMILARITY` 0.48, calibrated on 28 answerable vs 16 unanswerable questions) now abstains before generation; it stops all 6 off-topic questions and none of the 10 in-domain unanswerable ones (RAG_PIPELINE §6). Original finding: no relevance floor: the top 10 chunks always reach the LLM, and abstention depends on the model. Earlier measurement: 1 of 2 unanswerable questions flagged before the refusal check, 2 of 2 after (RAG_PIPELINE §11). | Log the top reranker score per answer, calibrate a threshold on answerable vs unanswerable gold questions, then return `insufficient_evidence` below it. Do not set a threshold without that data. |
| O3 | High | Verification of end to end | PostgreSQL/pgvector was never exercised: hybrid-search SQL, scope filter, upsert re-ingest, citation cascade. | EXPECTATIONS Priority 1. Run `docker compose up`, ingest the 12 eval PDFs, and run `eval/retrieval_eval.py` logic through `/search` plus `/evaluate` against the live stack. |
| O4 | Med | Answer quality eval | Answer-quality metrics (§6.2) need live Gemini; Gemini timed out from this machine. The cross-paper reasoning set (§6.3) does not exist. | Build a hand-checked set: for 3–5 paper groups, the expected per-paper facts, one known agreement, one contradiction and one stated limitation. Score `SynthesisVerifier` counts plus human judgement. |
| O5 | Med | Parsing | Line-break de-hyphenation also joins real compounds ("English-to-German" → "Englishto-German"), which hurts keyword match. | Keep the hyphen when both parts are dictionary words, or index both forms. Needs a word list. |
| O6 | Med | Chunking | The sentence splitter breaks after "et al." and "Fig.". That affects the overlap tail and citation windows, not retrieval. | Add an abbreviation guard to `split_sentences`. Re-check the citation-window metric afterwards. |
| O7 | Low | Chunking | Pieces under 120 characters are dropped in front matter (affiliations etc.; front matter is excluded from retrieval anyway). Tables under 80 characters are dropped. The trailing carried short section updates content but not `page_end`. | Log the dropped characters per document so silent loss is measurable (expectation §2.1). |
| O8 | Low | Chunking | Table chunks are always `section_type=results`, even hyper-parameter tables in Method. Table-caption chunks get the header "Section: Figure". | Use the page's section type; label table captions "Table". |
| O9 | Med | Profiles | `research_problem` is free LLM text with no grounding check, and it is shown in the matrix. Profiles see at most 28,000 characters of a paper. | Ground it like the other fields (evidence number plus quote). |
| O10 | Med | Latency | `load_papers` builds missing profiles synchronously with Gemini during a synthesis request (up to 30 papers). | Build missing profiles in the ingest job or a background task, and show "profile pending" instead. |
| O11 | Low | Retrieval | `attn-heads` (number of attention heads) is still outside the top 10. | Inspect that query's candidates; likely an equation-style passage ("h = 8"). |
| O12 | Low | Synthesis | With many papers (budget share ≤ kept chunks), evidence is ranked by RRF without the cross-encoder. The quality effect was not measured. | Measure with a many-paper gold set, or raise the budget on GPU hardware. |
| O13 | Low | Data integrity | Citations of chunks whose text changed on re-ingest are still removed by the `Citation → DocumentChunk` cascade. Unchanged chunks keep their ids. | Keep the cited text on the Citation row, or soft-delete changed chunks. |

## 4. Verification of this change

| Check | Result |
| --- | --- |
| `python -m pytest ai-service/rag -q` | **77 passed** (64 before + 13 new in `test_pipeline_review.py`) |
| `npm --prefix backend run test` | **23 passed** (2 suites) |
| `npx tsc --noEmit -p backend` | clean |
| `docker compose config -q` | OK |
| Retrieval eval (BGE-M3 + bge-reranker-v2-m3, CPU, 16 gold questions) | see §4.1 |

### 4.1 Retrieval after the change

Run on 2026-10-24: `eval/retrieval_eval.py --model BAAI/bge-m3 --reranker BAAI/bge-reranker-v2-m3 --batch-size 4`, CPU, 12 local PDFs,
16 gold questions, in-memory index with BM25 standing in for `ts_rank_cd` (not PostgreSQL). One question = 0.0625.

| Config | Recall@5 | MRR@10 | nDCG@10 | Evidence in first-600 snippet |
| --- | --- | --- | --- | --- |
| legacy page chunks, no router | 0.688 | 0.544 | 0.561 | 0.36 |
| section chunks, no router | 0.875 | 0.634 | 0.665 | 0.67 |
| **section + router filter, boost 0 (production default)** | **0.875** | **0.634** | **0.665** | 0.67 |
| section + router, boost 0.08 (old default) | 0.812 | 0.606 | 0.644 | 0.67 |
| section + router, boost 0, pool 40 | 0.812 | 0.632 | 0.663 | 0.67 |

Recall@5 and MRR@10 are identical to the 2026-10-23 run (RAG_PIPELINE §11), so the changes in this review did not alter
single-question retrieval. That was expected: `/ask` retrieval code is unchanged, and the rerank budget only applies to multi-paper
tasks. nDCG@10 is new. Per-question ranks are unchanged; `attn-heads` is still missing from the top 10 (O11).

## 5. How this maps to EXPECTATIONS.md

| Expectation | Status after this change |
| --- | --- |
| §2.2 every important claim supported or marked uncertain | Claims with wrong numbers and uncited sentences are now disclosed (F1, F2). Meaning-level errors remain (O1). |
| §2.3 / §2.4 / §2.5 synthesis traceable, no mixed-up papers, gaps distinguished from speculation | Sentence verification, attribution check, gap `support` = stated / inferred / ungrounded (F4–F6). Not yet scored against a hand-checked set (O4). |
| §5 response speed / no indefinite waiting | Synthesis bounded by a rerank budget and its own timeouts (F7, F10, F11), on top of the Q&A fixes of 2026-10-23. |
| §6.1 Recall@K, MRR, nDCG | All three reported (F12). |
| §8 Priority 1 end-to-end on PostgreSQL | **Open** (O3). |
