"""Embedding batches are bounded by attention memory (batch x longest^2), so one
long chunk cannot OOM-kill the AI service, and vectors stay in chunk order."""
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _import_ingest(monkeypatch, store):
    # ingest imports pg_store at module level; give it a stand-in.
    module = types.ModuleType("vector_store.pg_store")
    module.BGE_M3_DIMENSIONS = 1024
    module.pg_store = store
    monkeypatch.setitem(sys.modules, "vector_store.pg_store", module)
    sys.modules.pop("ingest", None)
    import ingest
    return ingest


class FakeStore:
    def __init__(self, chunks):
        self.chunks = chunks
        self.saved = None

    def get_unembedded_chunks(self, document_id):
        return [dict(c) for c in self.chunks]

    def update_chunk_embeddings(self, document_id, chunks, model):
        self.saved = chunks


class FakeModel:
    """Tokens = words; the vector records the text so order can be checked."""
    max_seq_length = 8192

    def __init__(self):
        self.batches = []

    def tokenizer(self, texts, **_):
        return {"input_ids": [t.split() for t in texts]}

    def encode(self, texts, batch_size, normalize_embeddings, show_progress_bar):
        self.batches.append(len(texts))
        return [[float(len(t.split()))] for t in texts]


def test_short_chunks_keep_full_batches(monkeypatch):
    ingest = _import_ingest(monkeypatch, FakeStore([]))
    batches = ingest.length_bounded_batches([300] * 40, max_batch=16, reference_tokens=512)
    assert [len(b) for b in batches] == [16, 16, 8]


def test_long_chunk_gets_a_small_batch(monkeypatch):
    ingest = _import_ingest(monkeypatch, FakeStore([]))
    lengths = [2800] + [400] * 20
    batches = ingest.length_bounded_batches(lengths, max_batch=16, reference_tokens=512)
    budget = 16 * 512 ** 2
    assert batches[0] == [0]  # the 2.8k-token chunk is embedded alone
    for batch in batches:
        assert len(batch) == 1 or len(batch) * max(lengths[i] for i in batch) ** 2 <= budget
    assert sorted(i for b in batches for i in b) == list(range(len(lengths)))


def test_embed_document_keeps_vectors_in_chunk_order(monkeypatch):
    chunks = [{"id": f"c{i}", "content": " ".join(["w"] * n)} for i, n in enumerate([5, 3000, 7, 1200, 2])]
    store = FakeStore(chunks)
    ingest = _import_ingest(monkeypatch, store)
    model = FakeModel()
    monkeypatch.setattr(ingest, "get_model", lambda: model)

    result = ingest.embed_document("doc-1")

    assert result["chunks_embedded"] == 5
    assert [c["embedding"][0] for c in store.saved] == [5.0, 3000.0, 7.0, 1200.0, 2.0]
    assert max(model.batches) <= ingest.EMBED_BATCH_SIZE
    assert model.batches[0] == 1  # the longest chunk went through on its own
