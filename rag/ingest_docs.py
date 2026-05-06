import sys
from pathlib import Path

# Add project root to Python path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import chromadb
from sentence_transformers import SentenceTransformer
from langchain.text_splitter import RecursiveCharacterTextSplitter
from config import DOCS_DIR, CHROMA_DIR, LOCAL_EMBEDDING_MODEL, CHROMA_COLLECTION_NAME

def ingest_documents():
    print(f"Loading embedding model: {LOCAL_EMBEDDING_MODEL}")
    model = SentenceTransformer(LOCAL_EMBEDDING_MODEL)

    print(f"Connecting to ChromaDB at: {CHROMA_DIR}")
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))

    # Always use the collection name from config — must match what the retrieval
    # tool queries.  Previously hardcoded to 'hr_docs_v2' while the retrieval
    # tool queried 'hr_policies', so every search returned zero results.
    print(f"Target collection: {CHROMA_COLLECTION_NAME}")
    try:
        client.delete_collection(CHROMA_COLLECTION_NAME)
        print(f"Deleted existing collection '{CHROMA_COLLECTION_NAME}'")
    except Exception:
        pass

    collection = client.create_collection(name=CHROMA_COLLECTION_NAME)

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=50,
    )

    docs_path = Path(DOCS_DIR)
    if not docs_path.exists():
        print(f"ERROR: Documents directory not found at {docs_path}")
        return

    files = [f for f in docs_path.glob("*") if f.is_file()]
    print(f"Found {len(files)} file(s) in {docs_path}")

    total_chunks = 0
    skipped = []

    for file_path in files:
        print(f"Processing {file_path.name}…")
        try:
            text = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            print(f"  ⚠ Skipping {file_path.name} (binary / non-UTF-8)")
            skipped.append(file_path.name)
            continue
        except Exception as e:
            print(f"  ⚠ Skipping {file_path.name}: {e}")
            skipped.append(file_path.name)
            continue

        chunks = text_splitter.split_text(text)
        if not chunks:
            print(f"  ⚠ No text extracted from {file_path.name}")
            continue

        embeddings = [model.encode(chunk).tolist() for chunk in chunks]

        collection.add(
            documents=chunks,
            embeddings=embeddings,
            metadatas=[{"source": file_path.name, "chunk": i} for i in range(len(chunks))],
            ids=[f"{file_path.name}_{i}" for i in range(len(chunks))],
        )
        total_chunks += len(chunks)
        print(f"  ✓ {len(chunks)} chunks ingested from {file_path.name}")

    print(f"\n✅ Ingestion complete.")
    print(f"   Total chunks : {total_chunks}")
    print(f"   Collection   : {CHROMA_COLLECTION_NAME}")
    if skipped:
        print(f"   Skipped      : {', '.join(skipped)}")


if __name__ == "__main__":
    ingest_documents()