# DocLens AI — Product Expectations

## 1. Product Vision

DocLens AI is an AI-powered research intelligence platform designed to help students, researchers, and academics understand research papers, synthesize scientific literature, discover research gaps, and develop new research ideas.

DocLens should be more than a basic PDF chatbot. It should function as a reliable research assistant that can read, retrieve, compare, analyze, and explain scientific literature using evidence-backed answers.

**Core objective:** Reduce the time required to understand existing research while improving the accuracy, traceability, and quality of research insights.

---

## 2. Core Product Features

### 2.1 Research Paper Understanding

Users should be able to upload scientific PDFs and extract meaningful information, including:

- Research objectives and problem statements
- Methodologies and models
- Datasets and experimental settings
- Results and evaluation metrics
- Conclusions and limitations
- References and relevant citations

**Expectation:** Important information must not be silently lost during PDF parsing, section extraction, or chunking.

### 2.2 Evidence-Grounded Research Chat

Users should be able to ask questions about one or multiple uploaded papers.

The system must:

- Retrieve relevant passages from the selected documents.
- Generate answers grounded in retrieved evidence.
- Provide accurate citations linked to the correct papers and passages.
- Support follow-up questions and contextual conversations.
- Clearly communicate when the available evidence is insufficient.
- Avoid fabricated facts, references, and citations.

**Expectation:** Every important factual claim should be supported by evidence or explicitly identified as uncertain.

### 2.3 Literature Review Generation

DocLens should generate structured literature reviews by synthesizing findings across multiple papers.

Expected capabilities:

- Organize research by themes and methodologies.
- Summarize findings across studies.
- Identify agreements and contradictions.
- Compare approaches, datasets, and results.
- Highlight limitations and unresolved problems.
- Generate coherent, citation-supported academic content.

**Expectation:** The output should provide genuine cross-paper synthesis rather than simply combining individual paper summaries.

### 2.4 Research-Gap Analysis

DocLens should help researchers identify potential research opportunities by analyzing multiple papers.

Expected capabilities:

- Identify underexplored research areas.
- Discover methodological limitations and unresolved questions.
- Compare existing approaches and their shortcomings.
- Explain why a proposed gap is supported by the available evidence.
- Suggest testable research questions and possible directions.
- Provide supporting citations for important conclusions.

**Expectation:** Research gaps must be evidence-based, logically defensible, and clearly distinguished from speculation.

### 2.5 Research Paper Comparison

Users should be able to compare multiple papers across:

- Research objectives
- Methodologies and models
- Datasets and experimental settings
- Evaluation metrics and results
- Strengths and limitations
- Conclusions and future research directions

**Expectation:** Comparisons must preserve the context of each paper and must not mix findings or attribute results to the wrong study.

---

## 3. What Differentiates DocLens AI?

The primary differentiator is its ability to reason across research papers rather than merely summarize individual documents.

The intended workflow is:

1. **Upload:** Users upload one or more research papers.
2. **Parse:** Extract text and preserve meaningful document structure.
3. **Index:** Create section-aware chunks and embeddings.
4. **Retrieve:** Find relevant evidence using hybrid search and ranking.
5. **Validate:** Organize evidence and verify citation relationships.
6. **Analyze:** Perform research chat, literature review, comparison, or gap analysis.
7. **Generate:** Produce structured, evidence-grounded responses.
8. **Verify:** Communicate uncertainty and avoid unsupported claims.

**Expected outcome:** Users can move from a collection of research papers to a defensible understanding of the research landscape.

---

## 4. Technical Expectations

DocLens already has an architecture intended to support these capabilities.

| Component | Technology / Approach |
|---|---|
| Frontend | React |
| Application backend | NestJS |
| AI service | FastAPI |
| PDF parsing | PyMuPDF |
| Database | PostgreSQL |
| Vector search | pgvector |
| ORM | Prisma |
| Embeddings | BGE-M3 |
| Retrieval | Hybrid search |
| Ranking | Reciprocal Rank Fusion (RRF) |
| Reranking | BGE cross-encoder |
| Caching | Redis |
| Authentication | JWT and authorization checks |
| AI integration | Retrieval-grounded generation |

The expectation is to make the existing implementation reliable and measurable.

**Do not rebuild the system from scratch or overwrite working changes without inspecting the current implementation first.**

---

## 5. Quality and Reliability Requirements

| Area | Expected Outcome |
|---|---|
| PDF ingestion | Important content is extracted without silent text loss. |
| Retrieval | Relevant passages are retrieved for single-paper and cross-paper questions. |
| Answer generation | Responses are accurate, relevant, and grounded in evidence. |
| Citation correctness | Citations point to the correct papers and support the associated claims. |
| Literature review | Findings are synthesized across papers with traceable citations. |
| Research-gap analysis | Proposed gaps are defensible and supported by evidence. |
| Response speed | Answers arrive within a reasonable time. |
| Error handling | Users receive actionable errors instead of indefinite loading states. |
| Security | Users cannot access documents or results belonging to other users. |
| Data integrity | Re-ingestion and retries do not unnecessarily destroy existing data. |
| Scalability | The system handles concurrent users and large research documents reliably. |
| Observability | Logs and metrics help identify retrieval, generation, and infrastructure failures. |

---

## 6. Evaluation Metrics

DocLens must be evaluated using a manually verified dataset of research questions, relevant passages, expected claims, and citation targets.

### 6.1 Retrieval Quality

Measure:

- Recall@K
- Mean Reciprocal Rank (MRR)
- Normalized Discounted Cumulative Gain (nDCG)

These metrics help determine whether the system retrieves the most relevant evidence.

### 6.2 Answer Quality

Measure:

- Factual correctness
- Evidence relevance
- Claim-to-evidence support
- Unsupported-claim rate
- Citation precision and correctness
- Appropriate abstention when evidence is insufficient

### 6.3 Cross-Paper Reasoning

Evaluate whether the system can:

- Accurately synthesize findings from multiple papers.
- Identify genuine agreements and contradictions.
- Compare methodologies without mixing up results.
- Produce research gaps supported by evidence.
- Generate useful research questions without inventing findings.

### 6.4 Performance and Reliability

Measure:

- Median and tail query latency
- PDF ingestion success rate
- Timeout and error rates
- Retrieval and generation latency separately
- Performance under concurrent requests
- Recovery from failed requests and ingestion jobs

### 6.5 Security and Data Integrity

Verify:

- Document ownership and access control.
- Internal AI-service authentication.
- Restricted upload and ingestion paths.
- Safe re-ingestion and retry behavior.
- Preservation of unchanged chunks, vectors, and citations where appropriate.
- Protection against unauthorized document access.

**Important:** Establish a trustworthy baseline before setting numerical acceptance targets. Evaluate each capability separately rather than relying on a single overall accuracy score.

---

## 7. Current Retrieval Evaluation

The latest recorded BGE evaluation reported:

| Configuration | Recall@5 |
|---|---:|
| Legacy chunks | 0.688 |
| Section-based chunks | 0.812 |
| Production retrieval router | 0.750 |

### Interpretation

- Section-based chunking improved Recall@5 in the evaluated BGE setup.
- The production retrieval router achieved lower Recall@5 than the standalone section-chunk evaluation.
- The production retrieval path needs further investigation to understand this difference.
- Retrieval performance alone does not establish the correctness of generated answers or citations.

The previous audit also noted that testing against the live PostgreSQL/pgvector stack and evaluating with the BGE models remained outstanding at that time. Their current status must be verified before considering the audit complete.

---

## 8. Immediate Priorities

### Priority 1: End-to-End Verification

Test the actual application-to-AI-service workflow against PostgreSQL/pgvector.

Verify ingestion, indexing, retrieval, generation, citations, authentication, and error handling.

### Priority 2: Improve Retrieval Quality

Investigate why the production router achieves lower Recall@5 than the standalone BGE evaluation.

Evaluate the complete retrieval pipeline using a fixed, manually verified dataset.

### Priority 3: Verify Citation Accuracy

Check whether citations:

- Refer to the correct paper.
- Point to the correct evidence.
- Support the claims they accompany.
- Remain correct after document re-ingestion.

### Priority 4: Evaluate Research Intelligence Features

Test literature reviews, multi-paper comparisons, and research-gap analyses for factual correctness, cross-paper consistency, evidence quality, and citation support.

### Priority 5: Improve Response Latency

Identify slow stages in retrieval, reranking, LLM generation, and database access.

Implement appropriate timeouts, progress indicators, error handling, and performance optimizations.

Users must not be left waiting indefinitely without knowing whether a response is being generated or has failed.

### Priority 6: Protect Data Integrity and Security

Regression-test document ownership, internal service authentication, upload restrictions, re-ingestion, and preservation of existing data.

### Priority 7: Document Results

Maintain clear records of:

- Evaluation methodology
- Dataset and test conditions
- Retrieval and answer-quality metrics
- Passed and failed tests
- Known limitations
- Unverified production behavior

**Priority principle:** Fix correctness, traceability, reliability, and response speed before adding more features.

---

## 9. Definition of Product Success

DocLens AI should enable a researcher to answer questions such as:

- What are the main findings across these 20 papers?
- Which methodologies perform best, and under what conditions?
- Where do these studies disagree?
- What limitations remain unresolved?
- What research questions could I investigate next?
- Which exact passages support each conclusion?

The system should provide answers that are:

- **Accurate:** Claims reflect the available research evidence.
- **Traceable:** Citations allow users to verify conclusions.
- **Context-aware:** Findings from different papers are not confused.
- **Useful:** Outputs support real academic research workflows.
- **Reliable:** Failures and limitations are communicated clearly.
- **Fast:** Users receive timely responses without indefinite waiting.
- **Honest:** Unsupported claims and uncertainty are disclosed.

---

## 10. Final Product Expectation

DocLens AI should transform a collection of research papers into a structured, evidence-backed understanding of the research landscape.

Its value should come from combining accurate document understanding, high-quality retrieval, trustworthy citations, cross-paper synthesis, and defensible research-gap discovery in one platform.

The goal is not simply to generate more AI content. The goal is to help researchers understand existing knowledge, evaluate evidence, identify unresolved problems, and develop better research questions with less manual effort.

**Core product principle: Every important research claim should be supported by evidence, linked to its source, or explicitly identified as uncertain or unsupported.**