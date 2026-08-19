from docling.document_converter import DocumentConverter
from docling.chunking import HierarchicalChunker
from sentence_transformers import SentenceTransformer
from vector_store.pg_store import pg_store

model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')

def ingest_document(document_id: str, file_path: str, collection_id: str):
    """
    Parses a PDF using Docling, chunks using HierarchicalChunker,
    embeds chunks, and stores them in PostgreSQL with structure metadata.
    """
    title = pg_store.get_document_title(document_id)

    # 1. Convert with Docling
    converter = DocumentConverter()
    conv_res = converter.convert(file_path)
    doc = conv_res.document

    # 2. Extract Chunks (structure-aware)
    chunker = HierarchicalChunker()
    chunks = list(chunker.chunk(doc))

    if not chunks:
        return {"status": "failed", "message": "No text found in PDF"}

    all_chunks = []
    
    for i, c in enumerate(chunks):
        # Extract metadata
        headings = c.meta.headings if c.meta and hasattr(c.meta, 'headings') else []
        section = headings[0] if headings else ""
        subsection = headings[-1] if len(headings) > 1 else ""
        
        # Determine page range safely
        page_nos = []
        if c.meta and c.meta.doc_items:
            for item in c.meta.doc_items:
                if hasattr(item, 'prov') and item.prov:
                    for p in item.prov:
                        if hasattr(p, 'page_no'):
                            page_nos.append(p.page_no)
        
        page_start = min(page_nos) if page_nos else None
        page_end = max(page_nos) if page_nos else None
        
        content_type = c.meta.doc_items[0].label if c.meta and c.meta.doc_items else "text"

        # Format chunk content for embedding
        section_text = f"Section: {' > '.join(headings)}\n\n" if headings else ""
        rich_content = f"Paper: {title}\n{section_text}{c.text}"

        all_chunks.append({
            "content": rich_content,
            "pageNumber": page_start,
            "chunkIndex": i,
            "metadata": {
                "paper_id": document_id,
                "chunk_index": i,
                "section": section,
                "subsection": subsection,
                "page_start": page_start,
                "page_end": page_end,
                "content_type": content_type
            }
        })

    # 3. Compute embeddings
    texts_to_embed = [c["content"] for c in all_chunks]
    embeddings = model.encode(texts_to_embed)
    
    for i, c in enumerate(all_chunks):
        c["embedding"] = embeddings[i].tolist()
        
    # 4. Store in Postgres
    pg_store.insert_chunks(all_chunks, document_id)
    
    return {"status": "completed", "chunks_processed": len(all_chunks)}
