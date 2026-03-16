import chromadb
import os
from config import CHROMA_DIR

def test_chroma():
    print(f"Testing ChromaDB at {CHROMA_DIR}")
    try:
        client = chromadb.PersistentClient(path=str(CHROMA_DIR))
        collection = client.get_collection(name="hr_docs_v2")
        print(f"Collection count: {collection.count()}")
        
        # Try a simple query
        results = collection.query(
            query_texts=["test"],
            n_results=1
        )
        print("Query successful!")
        print(results)
    except Exception as e:
        print(f"Caught expected error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_chroma()
