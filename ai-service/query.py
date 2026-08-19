import os
import requests
import google.generativeai as genai
from vector_store.pg_store import pg_store
from ingest import model

def call_llm(prompt: str, system_message: str = "You are a helpful research assistant.", history: list = None):
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
    if not GEMINI_API_KEY:
        return "This is a mocked LLM response since GEMINI_API_KEY is not set in the ai-service environment."

    llm_model = os.getenv("LLM_MODEL", "gemini-3.6-flash")
    if llm_model.startswith("google/"):
        llm_model = llm_model.split("/", 1)[1]
    if llm_model.endswith(":free"):
        llm_model = llm_model.replace(":free", "")

    genai.configure(api_key=GEMINI_API_KEY)
    
    try:
        model = genai.GenerativeModel(
            model_name=llm_model,
            system_instruction=system_message
        )
        
        if history:
            formatted_history = []
            for msg in history:
                formatted_history.append({
                    "role": "user" if msg["role"] == "user" else "model",
                    "parts": [{"text": msg["content"]}]
                })
            chat = model.start_chat(history=formatted_history)
            response = chat.send_message(prompt)
        else:
            response = model.generate_content(prompt)
            
        return response.text
    except Exception as e:
        import traceback
        traceback.print_exc()
        return f"Error calling Gemini LLM: {str(e)}"

def format_citations(chunks):
    citations = []
    context_text = ""
    for i, c in enumerate(chunks):
        context_text += f"\n[Citation {i+1}]: {c['content']}\n"
        citations.append({
            "chunkId": c["id"],
            "documentId": c["documentId"],
            "pageNumber": c["pageNumber"],
            "sourceText": c["content"],
            "relevance": c.get("score")
        })
    return context_text, citations

def ask_question(question: str, collection_id: str, document_ids=None, top_k=10, history=None):
    query_embedding = model.encode(question).tolist()
    
    chunks = pg_store.search(query_embedding, collection_id, document_ids, top_k)
    
    if not chunks:
        return {"answer": "No relevant context found to answer the question.", "citations": []}
        
    context_text, citations = format_citations(chunks)
    
    prompt = f"""Answer the user's question based strictly on the provided context. 

Provide a highly detailed, comprehensive, and well-structured response, explaining the concepts thoroughly just like a standard advanced generative AI assistant would.
If the context contains sentence fragments (e.g., words broken across lines like "- tively"), you must synthesize them into complete, grammatically correct sentences in your answer. Do not copy-paste fragments verbatim.
**IMPORTANT:** Treat synonymous concepts as equivalent. For example, if the user asks for "accuracy", and the text provides a "detection percentage", "success rate", or "performance rate", you MUST provide that information instead of claiming the text doesn't mention accuracy.

Context:
{context_text}

Question: {question}"""
    system_msg = "You are DocLens AI, a friendly, conversational, and highly intelligent research assistant with a witty and engaging personality. You must ALWAYS answer in complete, grammatically correct sentences. Provide detailed, comprehensive answers that thoroughly explain the concepts based on the documents, synthesizing information rather than just copy-pasting raw document chunks."
    
    answer = call_llm(prompt, system_message=system_msg, history=history)
    
    return {
        "answer": answer,
        "citations": citations
    }

def summarize_document(document_id: str):
    # Dummy embedding to just get chunks or we can just fetch chunks from DB directly.
    # To summarize, we'll fetch top chunks that are most central, or just fetch random chunks for now.
    query_embedding = model.encode("summary overview abstract introduction").tolist()
    chunks = pg_store.search(query_embedding, None, [document_id], top_k=10)
    
    if not chunks:
         return {"summary": "No text found for this document to summarize."}
         
    context_text, _ = format_citations(chunks)
    prompt = f"Summarize the following excerpts from a document:\n\n{context_text}"
    
    summary = call_llm(prompt, "You are an expert summarizer.")
    return {"summary": summary}

def review_document(document_id: str):
    query_embedding = model.encode("conclusion findings limitations future work").tolist()
    chunks = pg_store.search(query_embedding, None, [document_id], top_k=10)
    
    if not chunks:
         return {"review": "No text found for this document to review."}
         
    context_text, _ = format_citations(chunks)
    prompt = f"Provide a critical review and analysis of the following document excerpts:\n\n{context_text}"
    
    review = call_llm(prompt, "You are a critical academic reviewer.")
    return {"review": review}

def compare_documents(document_ids, collection_id, question, top_k=12):
    query = question if question else "Compare the main findings, methodologies, and conclusions."
    query_embedding = model.encode(query).tolist()
    
    chunks = pg_store.search(query_embedding, collection_id, document_ids, top_k)
    
    if not chunks:
        return {"answer": "No relevant context found to compare.", "citations": []}
        
    context_text, citations = format_citations(chunks)
    prompt = f"Compare the documents based on the following excerpts. Ensure you address this query: '{query}'\n\nContext:\n{context_text}"
    
    answer = call_llm(prompt, "You are an expert academic research assistant comparing papers.")
    
    return {
        "answer": answer,
        "citations": citations
    }

def literature_review(collection_id, document_ids, topic):
    query = topic if topic else "Comprehensive literature review"
    query_embedding = model.encode(query).tolist()
    
    chunks = pg_store.search(query_embedding, collection_id, document_ids, top_k=15)
    
    if not chunks:
        return {"review": "No relevant context found."}
        
    context_text, _ = format_citations(chunks)
    prompt = f"Write a comprehensive literature review on the topic: '{query}' based ONLY on the following excerpts. Synthesize the information clearly.\n\nContext:\n{context_text}"
    
    review = call_llm(prompt, "You are an expert academic writer.")
    
    return {
        "review": review
    }
