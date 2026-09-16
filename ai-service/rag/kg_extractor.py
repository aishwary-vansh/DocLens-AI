# ai-service/rag/kg_extractor.py
# ─────────────────────────────────────────────────────────────────────────────
# Asynchronous Knowledge Graph extraction.
#
# This runs as a FastAPI BackgroundTask AFTER ingestion completes, so it
# does NOT block document upload or chunking.
#
# Extracts: Authors, Papers, Concepts, Datasets, Methods, Models, Metrics, Tasks
# Every relationship references the evidence_chunk_id it was extracted from.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import logging
import os
from typing import List, Dict, Any

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import SystemMessage, HumanMessage

from .schemas import KGEntity, KGRelationship, KGExtractionResult

logger = logging.getLogger(__name__)

# Maximum chunks to send to KG extraction in one LLM call
# (to stay within context window limits)
KG_CHUNK_BATCH_SIZE = 10

VALID_ENTITY_TYPES = {
    "AUTHOR", "PAPER", "CONCEPT", "DATASET",
    "METHOD", "MODEL", "METRIC", "TASK",
}

VALID_RELATION_TYPES = {
    "USES", "EVALUATED_ON", "REPORTS", "COMPARED_WITH", "BASED_ON",
    "RELATED_TO", "AUTHORED_BY", "HAS_CONCEPT", "HAS_METHOD",
    "HAS_DATASET", "HAS_METRIC", "HAS_MODEL",
}

_KG_SYSTEM = """You are a scientific knowledge graph extractor.

Extract named entities and relationships from the provided document chunks.

ENTITY TYPES (use exactly these strings):
  AUTHOR, PAPER, CONCEPT, DATASET, METHOD, MODEL, METRIC, TASK

RELATIONSHIP TYPES (use exactly these strings):
  USES, EVALUATED_ON, REPORTS, COMPARED_WITH, BASED_ON,
  RELATED_TO, AUTHORED_BY, HAS_CONCEPT, HAS_METHOD, HAS_DATASET, HAS_METRIC, HAS_MODEL

RULES:
1. Only extract entities that are explicitly mentioned in the evidence.
2. Every relationship MUST reference an evidence_chunk_id from the provided chunks.
3. evidence_text must be a verbatim excerpt from the chunk.
4. normalized_name should be lowercase with underscores (e.g., "bert_model").
5. Do not hallucinate entities or relationships.
6. If a chunk contains no extractable KG information, skip it.

Output valid JSON matching this schema:
{format_instructions}"""

_KG_HUMAN = """Document ID: {document_id}

Chunks to analyse:
{chunks_text}

Extract all Knowledge Graph entities and relationships."""


def _format_chunks_for_kg(chunks: list) -> str:
    """Format chunks with their IDs for KG extraction context."""
    parts = []
    for chunk in chunks:
        chunk_id = chunk.get("id", chunk.get("chunk_id", "unknown"))
        parts.append(
            f"[chunk_id: {chunk_id}]\n"
            f"Page: {chunk.get('pageNumber', 'N/A')}\n"
            f"{chunk.get('content', '')}\n"
        )
    return "\n---\n".join(parts)


def extract_kg_from_document(document_id: str, chunks: list) -> KGExtractionResult:
    """
    Extract Knowledge Graph entities and relationships from document chunks.

    This is called as a BackgroundTask after ingestion — does NOT block the
    main ingestion response.

    Args:
        document_id: UUID of the document in the database
        chunks: list of raw chunk dicts from pg_store (with 'id', 'content', etc.)

    Returns:
        KGExtractionResult with entities and relationships
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY not set — skipping KG extraction for document %s", document_id)
        return KGExtractionResult(document_id=document_id)

    from langchain_google_genai import ChatGoogleGenerativeAI

    model_name = os.getenv("LLM_MODEL", "gemini-1.5-flash").replace("google/", "").replace(":free", "")
    llm = ChatGoogleGenerativeAI(
        model=model_name,
        google_api_key=api_key,
        temperature=0.0,  # Zero temperature for deterministic extraction
    )

    parser = PydanticOutputParser(pydantic_object=KGExtractionResult)
    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=_KG_SYSTEM.format(format_instructions=parser.get_format_instructions())),
        HumanMessage(content=_KG_HUMAN),
    ])
    chain = prompt | llm | parser

    all_entities: List[KGEntity] = []
    all_relationships: List[KGRelationship] = []
    chunk_ids = {c.get("id", c.get("chunk_id")) for c in chunks}

    # Process in batches to stay within context window
    for batch_start in range(0, len(chunks), KG_CHUNK_BATCH_SIZE):
        batch = chunks[batch_start: batch_start + KG_CHUNK_BATCH_SIZE]
        chunks_text = _format_chunks_for_kg(batch)

        try:
            result: KGExtractionResult = chain.invoke({
                "document_id":  document_id,
                "chunks_text":  chunks_text,
            })

            # Validate entity types
            for entity in result.entities:
                if entity.entity_type.upper() not in VALID_ENTITY_TYPES:
                    logger.warning("Skipping entity with unknown type: %s", entity.entity_type)
                    continue
                entity.entity_type = entity.entity_type.upper()
                all_entities.append(entity)

            # Validate relationships
            for rel in result.relationships:
                if rel.relation_type.upper() not in VALID_RELATION_TYPES:
                    logger.warning("Skipping relationship with unknown type: %s", rel.relation_type)
                    continue
                rel.relation_type = rel.relation_type.upper()
                # Ensure evidence chunk is from this document's actual chunks
                if rel.evidence_chunk_id and rel.evidence_chunk_id not in chunk_ids:
                    logger.warning(
                        "Relationship evidence_chunk_id %s not in document chunks — removing reference",
                        rel.evidence_chunk_id,
                    )
                    rel.evidence_chunk_id = None
                    rel.evidence_text = None
                all_relationships.append(rel)

        except Exception as e:
            logger.error(
                "KG extraction failed for batch %d-%d of document %s: %s",
                batch_start,
                batch_start + len(batch),
                document_id,
                e,
            )
            continue

    logger.info(
        "KG extraction complete — document=%s entities=%d relationships=%d",
        document_id,
        len(all_entities),
        len(all_relationships),
    )

    return KGExtractionResult(
        document_id=document_id,
        entities=all_entities,
        relationships=all_relationships,
    )


def persist_kg_result(document_id: str, result: KGExtractionResult) -> None:
    """
    Persist extracted KG entities and relationships to PostgreSQL via pg_store.
    Calls pg_store.insert_entities and pg_store.insert_relationships.
    """
    from vector_store.pg_store import pg_store

    if result.entities:
        try:
            pg_store.insert_entities(document_id, result.entities)
            logger.info("Persisted %d entities for document %s", len(result.entities), document_id)
        except Exception as e:
            logger.error("Failed to persist entities for document %s: %s", document_id, e)

    if result.relationships:
        try:
            pg_store.insert_relationships(document_id, result.relationships)
            logger.info("Persisted %d relationships for document %s", len(result.relationships), document_id)
        except Exception as e:
            logger.error("Failed to persist relationships for document %s: %s", document_id, e)
