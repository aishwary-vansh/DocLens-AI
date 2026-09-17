import os
import psycopg2
from dotenv import load_dotenv
import ingest

load_dotenv()
conn_str = os.getenv("DATABASE_URL")
upload_root = os.getenv("UPLOAD_ROOT", "/app")

def main():
    conn = psycopg2.connect(conn_str)
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT id, "fileUrl", "collectionId" FROM "Document"')
            docs = cur.fetchall()
            print(f"Found {len(docs)} documents in the database.")
            for doc in docs:
                doc_id, file_url, coll_id = doc
                abs_path = os.path.join(upload_root, file_url)
                print(f"Ingesting {doc_id} from {abs_path}")
                if os.path.exists(abs_path):
                    res = ingest.ingest_document(doc_id, abs_path, coll_id)
                    print(f"Result: {res}")
                else:
                    print(f"File not found: {abs_path}")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
