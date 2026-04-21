import sys
from pathlib import Path

# Add project root to Python path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import chromadb
from sentence_transformers import SentenceTransformer
from langchain.text_splitter import RecursiveCharacterTextSplitter
from config import DOCS_DIR, CHROMA_DIR, LOCAL_EMBEDDING_MODEL

def ingest_documents():
    print(f"Loading embedding model: {LOCAL_EMBEDDING_MODEL}")
    model = SentenceTransformer(LOCAL_EMBEDDING_MODEL)
    
    print(f"Connecting to ChromaDB at {CHROMA_DIR}")
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    
    # Delete old collection to start fresh (optional)
    try:
        client.delete_collection("hr_docs_v2")
        print("Deleted existing collection 'hr_docs_v2'")
    except:
        pass
    
    collection = client.create_collection(name="hr_docs_v2")
    
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    
    docs_path = Path(DOCS_DIR)
    if not docs_path.exists():
        print(f"ERROR: Documents directory not found at {docs_path}")
        return
    
    files = list(docs_path.glob("*"))
    print(f"Found {len(files)} files in {docs_path}")
    
    for file_path in files:
        if not file_path.is_file():
            continue
        print(f"Processing {file_path.name}...")
        try:
            # For text and markdown files
            with open(file_path, "r", encoding="utf-8") as f:
                text = f.read()
        except UnicodeDecodeError:
            print(f"  Skipping {file_path.name} (not a text file)")
            continue
        
        chunks = text_splitter.split_text(text)
        for i, chunk in enumerate(chunks):
            embedding = model.encode(chunk).tolist()
            collection.add(
                documents=[chunk],
                embeddings=[embedding],
                metadatas=[{"source": file_path.name, "chunk": i}],
                ids=[f"{file_path.name}_{i}"]
            )
        print(f"  Ingested {len(chunks)} chunks from {file_path.name}")
    
    print("✅ Ingestion complete.")

if __name__ == "__main__":
    ingest_documents()