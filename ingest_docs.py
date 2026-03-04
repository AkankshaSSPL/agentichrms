"""Ingest documents (PDF, CSV, Excel, MD, TXT, DOCX) into ChromaDB with metadata.

Uses RecursiveCharacterTextSplitter to break every document into ~500-char
chunks so that embeddings are focused and retrieval is precise.
"""
import os
import sys
import chromadb
import pandas as pd
import pyplumber
from sentence_transformers import SentenceTransformer
from langchain_text_splitters import RecursiveCharacterTextSplitter

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from config import CHROMA_DIR, DOCS_DIR, LOCAL_EMBEDDING_MODEL

# ── shared splitter ─────────────────────────────────────────
splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=80,
    separators=["\n\n", "\n", ". ", " ", ""],
)


# ── Extractors ──────────────────────────────────────────────

def extract_text_from_pdf(filepath):
    """Extract text from PDF, then sub-chunk each page."""
    reader = pypdf.PdfReader(filepath)
    filename = os.path.basename(filepath)
    chunks = []
    for page_idx, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if not text.strip():
            continue
        sub_chunks = splitter.split_text(text)
        for ci, sub in enumerate(sub_chunks):
            approx_start = ci * 400 + 1          # rough line estimate
            approx_end = approx_start + len(sub.split("\n"))
            chunks.append({
                "text": sub,
                "metadata": {
                    "source": filename,
                    "section": f"Page {page_idx + 1}",
                    "page": page_idx + 1,                     # <-- PAGE NUMBER
                    "start_line": approx_start,
                    "end_line": approx_end,
                },
            })
    return chunks


def extract_text_from_excel(filepath):
    """Convert Excel sheets to text and sub-chunk."""
    xls = pd.ExcelFile(filepath)
    filename = os.path.basename(filepath)
    chunks = []
    for sheet_name in xls.sheet_names:
        df = pd.read_excel(filepath, sheet_name=sheet_name)
        text = df.to_string()
        if len(text) < 20:
            continue
        full_text = f"Sheet: {sheet_name}\n\n{text}"
        sub_chunks = splitter.split_text(full_text)
        for ci, sub in enumerate(sub_chunks):
            chunks.append({
                "text": sub,
                "metadata": {
                    "source": filename,
                    "section": sheet_name,
                    "start_line": 1 + ci * 10,
                    "end_line": (ci + 1) * 10,
                },
            })
    return chunks


def extract_text_from_csv(filepath):
    """Convert CSV to text and sub-chunk."""
    df = pd.read_csv(filepath)
    text = df.to_string()
    filename = os.path.basename(filepath)
    sub_chunks = splitter.split_text(text)
    chunks = []
    for ci, sub in enumerate(sub_chunks):
        chunks.append({
            "text": sub,
            "metadata": {
                "source": filename,
                "section": "Data",
                "start_line": 1 + ci * 10,
                "end_line": (ci + 1) * 10,
            },
        })
    return chunks


def extract_text_from_txt(filepath):
    """Read plain text and sub-chunk."""
    filename = os.path.basename(filepath)
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
    if not content.strip():
        return []
    sub_chunks = splitter.split_text(content)
    chunks = []
    char_offset = 0
    for ci, sub in enumerate(sub_chunks):
        pos = content.find(sub, char_offset)
        if pos == -1:
            start_line = 1 + ci * 10
        else:
            start_line = content[:pos].count("\n") + 1
            char_offset = pos + len(sub)
        end_line = start_line + sub.count("\n")
        chunks.append({
            "text": sub,
            "metadata": {
                "source": filename,
                "section": "General",
                "start_line": start_line,
                "end_line": end_line,
            },
        })
    return chunks


def extract_text_from_docx(filepath):
    """Extract text from .docx and sub-chunk."""
    try:
        import docx
    except ImportError:
        print(f"  ⚠ python-docx not installed, skipping {filepath}")
        return []
    filename = os.path.basename(filepath)
    doc = docx.Document(filepath)
    full_text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    if not full_text.strip():
        return []
    sub_chunks = splitter.split_text(full_text)
    chunks = []
    char_offset = 0
    for ci, sub in enumerate(sub_chunks):
        pos = full_text.find(sub, char_offset)
        if pos == -1:
            start_line = 1 + ci * 10
        else:
            start_line = full_text[:pos].count("\n") + 1
            char_offset = pos + len(sub)
        end_line = start_line + sub.count("\n")
        chunks.append({
            "text": sub,
            "metadata": {
                "source": filename,
                "section": "General",
                "start_line": start_line,
                "end_line": end_line,
            },
        })
    return chunks


def split_markdown_by_headers(content: str, filename: str):
    """Split markdown by headers, then sub-chunk large sections."""
    lines = content.split("\n")
    raw_sections = []

    current_chunk_lines = []
    current_header = "General"
    start_line = 1

    for i, line in enumerate(lines):
        line_num = i + 1
        if line.strip().startswith("#"):
            if current_chunk_lines:
                text = "\n".join(current_chunk_lines).strip()
                if len(text) > 30:
                    raw_sections.append({
                        "text": text,
                        "header": current_header,
                        "start_line": start_line,
                        "end_line": line_num - 1,
                    })
            current_header = line.strip().lstrip("#").strip()
            current_chunk_lines = [line]
            start_line = line_num
        else:
            current_chunk_lines.append(line)

    if current_chunk_lines:
        text = "\n".join(current_chunk_lines).strip()
        if len(text) > 20:
            raw_sections.append({
                "text": text,
                "header": current_header,
                "start_line": start_line,
                "end_line": len(lines),
            })

    # Sub-chunk any section that exceeds splitter limit
    chunks = []
    for sec in raw_sections:
        if len(sec["text"]) <= 500:
            chunks.append({
                "text": sec["text"],
                "metadata": {
                    "source": filename,
                    "section": sec["header"],
                    "start_line": sec["start_line"],
                    "end_line": sec["end_line"],
                },
            })
        else:
            sub_chunks = splitter.split_text(sec["text"])
            total = len(sub_chunks)
            line_span = sec["end_line"] - sec["start_line"]
            for ci, sub in enumerate(sub_chunks):
                chunk_start = sec["start_line"] + int(ci / total * line_span)
                chunk_end = sec["start_line"] + int((ci + 1) / total * line_span)
                chunks.append({
                    "text": sub,
                    "metadata": {
                        "source": filename,
                        "section": sec["header"],
                        "start_line": chunk_start,
                        "end_line": chunk_end,
                    },
                })
    return chunks


# ── Main ────────────────────────────────────────────────────

def main():
    print(f"Loading embedding model: {LOCAL_EMBEDDING_MODEL} ...")
    model = SentenceTransformer(LOCAL_EMBEDDING_MODEL)

    print(f"Initializing ChromaDB at {CHROMA_DIR} ...")
    # Ensure directory exists
    os.makedirs(CHROMA_DIR, exist_ok=True)
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))

    # List existing collections
    collections = client.list_collections()
    print(f"Existing collections: {[col.name for col in collections]}")

    # Delete the collection if it exists
    collection_name = "hr_docs_v2"
    if any(col.name == collection_name for col in collections):
        try:
            client.delete_collection(collection_name)
            print(f"  Deleted existing {collection_name} collection.")
        except Exception as e:
            print(f"  Error deleting collection: {e}")
            # If deletion fails, we might need to handle differently
            # For now, we'll try to continue and see if we can create anyway
    else:
        print(f"  No existing {collection_name} collection to delete.")

    # Create a new collection
    try:
        collection = client.create_collection(name=collection_name)
        print(f"  Created new {collection_name} collection.")
    except Exception as e:
        print(f"  Error creating collection: {e}")
        # If creation fails, perhaps the collection still exists? Try get_or_create as fallback
        collection = client.get_or_create_collection(name=collection_name)
        print(f"  Using existing {collection_name} collection (may contain old data).")

    print(f"Scanning {DOCS_DIR} ...")
    if not os.path.exists(DOCS_DIR):
        os.makedirs(DOCS_DIR)

    all_chunks = []
    all_embeddings = []
    all_metadatas = []
    all_ids = []

    for filename in sorted(os.listdir(DOCS_DIR)):
        filepath = os.path.join(DOCS_DIR, filename)
        if not os.path.isfile(filepath):
            continue

        file_chunks = []

        if filename.lower().endswith(".md"):
            with open(filepath, "r", encoding="utf-8") as f:
                file_chunks = split_markdown_by_headers(f.read(), filename)
        elif filename.lower().endswith(".pdf"):
            file_chunks = extract_text_from_pdf(filepath)
        elif filename.lower().endswith((".xlsx", ".xls")):
            file_chunks = extract_text_from_excel(filepath)
        elif filename.lower().endswith(".csv"):
            file_chunks = extract_text_from_csv(filepath)
        elif filename.lower().endswith(".txt"):
            file_chunks = extract_text_from_txt(filepath)
        elif filename.lower().endswith(".docx"):
            file_chunks = extract_text_from_docx(filepath)
        else:
            print(f"  Skipped (unsupported): {filename}")
            continue

        if file_chunks:
            print(f"  ✓ {filename}: {len(file_chunks)} chunks")
            for i, c in enumerate(file_chunks):
                all_chunks.append(c["text"])
                all_embeddings.append(model.encode(c["text"]).tolist())
                all_metadatas.append(c["metadata"])
                all_ids.append(f"{filename}_{i}")
        else:
            print(f"  ⚠ Empty/skipped: {filename}")

    if not all_chunks:
        print("No valid documents found.")
        return

    print(f"\nUpserting {len(all_chunks)} chunks into ChromaDB ...")
    batch = 500
    for start in range(0, len(all_chunks), batch):
        end = min(start + batch, len(all_chunks))
        collection.upsert(
            documents=all_chunks[start:end],
            embeddings=all_embeddings[start:end],
            metadatas=all_metadatas[start:end],
            ids=all_ids[start:end],
        )
    print("✅ Ingestion complete.")


if __name__ == "__main__":
    main()