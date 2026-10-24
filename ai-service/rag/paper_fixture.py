# ai-service/rag/paper_fixture.py
# Builds a small synthetic research-paper PDF for parser/chunker tests.
from __future__ import annotations

LOREM = (
    "The proposed approach is evaluated carefully. It uses a transformer encoder with "
    "contrastive pre-training. Results are reported with mean and standard deviation. "
)

PAPER = [
    # (page, kind, text)
    (1, "title", "Contrastive Retrieval for Scientific Question Answering"),
    (1, "body", "Jane Doe, John Roe. University of Somewhere."),
    (1, "heading", "Abstract"),
    (1, "body", "We study retrieval for scientific question answering. " + LOREM * 3),
    (1, "heading", "1 Introduction"),
    (1, "body", "Scientific papers are long and dense. " + LOREM * 4),
    (2, "heading", "2 Related Work"),
    (2, "body", "Prior work used BM25 and dense retrievers [1]. " + LOREM * 3),
    (2, "heading", "3 Method"),
    (2, "body", "We propose ContraSci, a contrastive dual encoder. " + LOREM * 5),
    (2, "heading", "3.1 Training Objective"),
    (2, "body", "The loss is InfoNCE with in-batch negatives. " + LOREM * 2),
    (3, "heading", "4 Experiments"),
    (3, "body", "We evaluate on SciQ and PubMedQA datasets using Recall@10 and MRR. " + LOREM * 3),
    (3, "body", "Table 1: Retrieval results on SciQ. ContraSci reaches 81.2 Recall@10."),
    (3, "heading", "5 Limitations"),
    (3, "body", "Our evaluation covers only English biomedical text. We do not test multilingual corpora. " + LOREM),
    (3, "heading", "6 Conclusion and Future Work"),
    (3, "body", "ContraSci improves recall. Future work will extend it to multilingual papers. " + LOREM),
    (4, "heading", "References"),
    (4, "body", "[1] S. Robertson. The probabilistic relevance framework: BM25 and beyond. 2009."),
    (4, "body", "[2] V. Karpukhin et al. Dense passage retrieval for open-domain QA. EMNLP 2020."),
]


def build_paper_pdf(path: str) -> str:
    import fitz

    doc = fitz.open()
    pages: dict[int, object] = {}
    cursor: dict[int, float] = {}
    for page_no, kind, text in PAPER:
        if page_no not in pages:
            page = doc.new_page(width=595, height=842)
            pages[page_no] = page
            cursor[page_no] = 60.0
            page.insert_text((60, 30), "Preprint. Under review.", fontsize=8)
            page.insert_text((290, 820), str(page_no), fontsize=8)
        page = pages[page_no]
        size = {"title": 18, "heading": 12}.get(kind, 10)
        font = "hebo" if kind in {"title", "heading"} else "helv"
        rect = fitz.Rect(60, cursor[page_no], 535, 800)
        height_needed = (len(text) // 85 + 1) * size * 1.35 + 6
        page.insert_textbox(rect, text, fontsize=size, fontname=font)
        cursor[page_no] += height_needed + 8
    doc.save(path)
    doc.close()
    return path
