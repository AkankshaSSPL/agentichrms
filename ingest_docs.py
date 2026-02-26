"""Ingest documents (PDF, CSV, Excel, MD) into ChromaDB with metadata."""
import os
import chromadb
from sentence_transformers import SentenceTransformer
import sys
import pandas as pd
import pypdf

# Add parent directory
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from config import CHROMA_DIR, DOCS_DIR, LOCAL_EMBEDDING_MODEL

def extract_text_from_pdf(filepath):
    """Extract text from PDF page by page."""
    reader = pypdf.PdfReader(filepath)
    chunks = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        if text.strip():
            chunks.append({
                "text": text,
                "metadata": {
                    "source": os.path.basename(filepath),
                    "section": f"Page {i+1}",
                    "start_line": 1,
                    "end_line": len(text.split('\n'))
                }
            })
    return chunks

def extract_text_from_excel(filepath):
    """Convert Excel sheets to text representation."""
    xls = pd.ExcelFile(filepath)
    chunks = []
    for sheet_name in xls.sheet_names:
        df = pd.read_excel(filepath, sheet_name=sheet_name)
        text = df.to_string()
        if len(text) > 20:
             chunks.append({
                "text": f"Sheet: {sheet_name}\n\n{text}",
                "metadata": {
                    "source": os.path.basename(filepath),
                    "section": sheet_name,
                    "start_line": 1,
                    "end_line": len(df)
                }
            })
    return chunks

def extract_text_from_csv(filepath):
    """Convert CSV to text representation."""
    df = pd.read_csv(filepath)
    text = df.to_string()
    return [{
        "text": text,
        "metadata": {
            "source": os.path.basename(filepath),
            "section": "Data",
            "start_line": 1,
            "end_line": len(df)
        }
    }]

def split_markdown_by_headers(content: str, filename: str):
    """Smart split markdown by headers."""
    lines = content.split('\n')
    chunks = []
    
    current_chunk = []
    current_header = "General"
    start_line = 1
    
    for i, line in enumerate(lines):
        line_num = i + 1
        if line.strip().startswith('#'):
            if current_chunk:
                text = '\n'.join(current_chunk).strip()
                if len(text) > 50:
                    chunks.append({
                        "text": text,
                        "metadata": {
                            "source": filename,
                            "section": current_header,
                            "start_line": start_line,
                            "end_line": line_num - 1
                        }
                    })
            current_header = line.strip().lstrip('#').strip()
            current_chunk = [line]
            start_line = line_num
        else:
            current_chunk.append(line)

    if current_chunk:
        text = '\n'.join(current_chunk).strip()
        if len(text) > 20:
            chunks.append({
                "text": text,
                "metadata": {
                    "source": filename,
                    "section": current_header,
                    "start_line": start_line,
                    "end_line": len(lines)
                }
            })
    return chunks

def main():
    print(f"Loading local embedding model: {LOCAL_EMBEDDING_MODEL}...")
    model = SentenceTransformer(LOCAL_EMBEDDING_MODEL)

    print(f"Initializing ChromaDB at {CHROMA_DIR}...")
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    collection = client.get_or_create_collection(name="hr_docs_v2")

    print(f"Scanning {DOCS_DIR}...")
    all_chunks = []
    all_embeddings = []
    all_metadatas = []
    all_ids = []
    
    if not os.path.exists(DOCS_DIR):
        os.makedirs(DOCS_DIR)

    for filename in os.listdir(DOCS_DIR):
        filepath = os.path.join(DOCS_DIR, filename)
        file_chunks = []
        
        if filename.endswith(".md"):
            with open(filepath, "r", encoding="utf-8") as f:
                file_chunks = split_markdown_by_headers(f.read(), filename)
        elif filename.endswith(".pdf"):
            file_chunks = extract_text_from_pdf(filepath)
        elif filename.endswith(".xlsx") or filename.endswith(".xls"):
            file_chunks = extract_text_from_excel(filepath)
        elif filename.endswith(".csv"):
             file_chunks = extract_text_from_csv(filepath)
            
        if file_chunks:
            print(f"  Processed {filename}: {len(file_chunks)} chunks")
            for i, c in enumerate(file_chunks):
                all_chunks.append(c["text"])
                all_embeddings.append(model.encode(c["text"]).tolist())
                all_metadatas.append(c["metadata"])
                all_ids.append(f"{filename}_{i}")
        else:
            print(f"  Skipped/Empty: {filename}")

    if not all_chunks:
        print("No valid documents found.")
        return

    print(f"Upserting {len(all_chunks)} chunks to ChromaDB...")
    collection.upsert(
        documents=all_chunks,
        embeddings=all_embeddings,
        metadatas=all_metadatas,
        ids=all_ids
    )
    print("Ingestion complete.")

if __name__ == "__main__":
    main()
