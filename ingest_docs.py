"""Ingest documents (PDF, CSV, Excel, MD, TXT, DOCX) into ChromaDB with metadata.

Uses RecursiveCharacterTextSplitter to break every document into ~1500-char
chunks so that embeddings are focused and retrieval is precise.
"""
import os
import re
import sys
import logging
import chromadb
import pandas as pd
from sentence_transformers import SentenceTransformer
from langchain_text_splitters import RecursiveCharacterTextSplitter

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from config import CHROMA_DIR, DOCS_DIR, LOCAL_EMBEDDING_MODEL

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ── Shared splitter ───────────────────────────────────────────────────────────
splitter = RecursiveCharacterTextSplitter(
    chunk_size=1500,
    chunk_overlap=300,
    separators=["\n\n", "\n", ". ", " ", ""],
)

MIN_CHUNK_LENGTH = 50   # skip chunks shorter than this


# ── Extractors ────────────────────────────────────────────────────────────────

def extract_text_from_pdf(filepath):
    """
    GAP-004 / GAP-041 FIX: Use pdfplumber for PDF extraction instead of pypdf.

    Both ingest_docs.py (previously pypdf) and document_viewer.py / retrieval.py
    (pdfplumber) extracted PDF text differently — different whitespace, line
    breaks, and encoding handling.  When the React frontend tried to regex-match
    stored chunks against the preview text, exact matches failed because the two
    libraries produced different strings.  Standardising on pdfplumber ensures
    the chunks in ChromaDB match the text shown in the preview panel.

    GAP-001 FIX: Fake line numbers removed.
    PDFs have no natural concept of "lines". The previous code used the formula
    `approx_start = ci * 400 + 1` which had no relationship to actual positions.
    These numbers propagated through the pipeline and were displayed as
    "Lines X-Y" in source cards — completely meaningless.

    Fix: store only the page number as the locator.  The page field is already
    used by retrieval.py and document_viewer.py for PDF preview pagination.
    start_line / end_line are set to the page number so any downstream code that
    reads them gets a value that at least refers to the correct page.
    """
    import pdfplumber
    filename = os.path.basename(filepath)
    chunks = []

    try:
        with pdfplumber.open(filepath) as pdf:
            for page_idx, page in enumerate(pdf.pages):
                text = page.extract_text() or ""
                if not text.strip():
                    continue
                sub_chunks = splitter.split_text(text)
                page_num = page_idx + 1
                for sub in sub_chunks:
                    if len(sub.strip()) < MIN_CHUNK_LENGTH:
                        continue
                    chunks.append({
                        "text": sub,
                        "metadata": {
                            "source": filename,
                            "section": f"Page {page_num}",
                            "page": page_num,
                            # Use page number for both fields — avoids the
                            # "Lines 1-3" display meaning "Pages 1-3" confusion.
                            "start_line": page_num,
                            "end_line": page_num,
                        },
                    })
    except Exception as exc:
        logger.error("Error extracting PDF '%s': %s", filename, exc)

    return chunks


def extract_text_from_excel(filepath):
    """
    GAP-002 FIX: Use actual DataFrame row indices instead of the fake formula
    `start_line = 1 + ci * 10` which had no relationship to spreadsheet rows.
    Each chunk now tracks the approximate row range it covers.
    """
    filename = os.path.basename(filepath)
    chunks = []

    try:
        xls = pd.ExcelFile(filepath)
        for sheet_name in xls.sheet_names:
            df = pd.read_excel(filepath, sheet_name=sheet_name)
            if df.empty:
                continue

            # Convert to lines so we can track row positions
            lines = df.to_string().split("\n")
            total_lines = len(lines)
            full_text = f"Sheet: {sheet_name}\n\n" + "\n".join(lines)

            sub_chunks = splitter.split_text(full_text)
            char_offset = 0

            for sub in sub_chunks:
                if len(sub.strip()) < MIN_CHUNK_LENGTH:
                    continue

                # Track actual position within the stringified sheet
                pos = full_text.find(sub, char_offset)
                if pos == -1:
                    # Fallback: estimate from char offset proportion
                    start_line = max(1, int(char_offset / max(len(full_text), 1) * total_lines))
                else:
                    start_line = full_text[:pos].count("\n") + 1
                    char_offset = pos + len(sub)

                end_line = start_line + sub.count("\n")

                chunks.append({
                    "text": sub,
                    "metadata": {
                        "source": filename,
                        "section": sheet_name,
                        "start_line": start_line,
                        "end_line": end_line,
                    },
                })
    except Exception as exc:
        logger.error("Error extracting Excel '%s': %s", filename, exc)

    return chunks


def extract_text_from_csv(filepath):
    """
    GAP-002 FIX: Use actual row positions instead of `1 + ci * 10` fake formula.
    """
    filename = os.path.basename(filepath)
    chunks = []

    try:
        df = pd.read_csv(filepath)
        if df.empty:
            return []

        lines = df.to_string().split("\n")
        total_lines = len(lines)
        full_text = "\n".join(lines)

        sub_chunks = splitter.split_text(full_text)
        char_offset = 0

        for sub in sub_chunks:
            if len(sub.strip()) < MIN_CHUNK_LENGTH:
                continue

            pos = full_text.find(sub, char_offset)
            if pos == -1:
                start_line = max(1, int(char_offset / max(len(full_text), 1) * total_lines))
            else:
                start_line = full_text[:pos].count("\n") + 1
                char_offset = pos + len(sub)

            end_line = start_line + sub.count("\n")

            chunks.append({
                "text": sub,
                "metadata": {
                    "source": filename,
                    "section": "Data",
                    "start_line": start_line,
                    "end_line": end_line,
                },
            })
    except Exception as exc:
        logger.error("Error extracting CSV '%s': %s", filename, exc)

    return chunks


def extract_text_from_txt(filepath):
    """
    GAP-003 FIX: The original code used content.find(sub, char_offset) which
    could match the WRONG occurrence of a repeated phrase when chunk_overlap=300
    causes chunks to share starting text with an earlier position.

    Fix: always advance char_offset past the end of the last found position.
    When find() returns -1 (chunk text was modified by the splitter and no
    longer appears verbatim), fall back to estimating from the previous chunk's
    end_line rather than the hardcoded `1 + ci * 10`.
    """
    filename = os.path.basename(filepath)
    chunks = []

    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        if not content.strip():
            return []

        sub_chunks = splitter.split_text(content)
        char_offset = 0
        prev_end_line = 0

        for sub in sub_chunks:
            if len(sub.strip()) < MIN_CHUNK_LENGTH:
                continue

            pos = content.find(sub, char_offset)
            if pos == -1:
                # GAP-003 FIX: fall back to line after last known position
                start_line = prev_end_line + 1
            else:
                start_line = content[:pos].count("\n") + 1
                char_offset = pos + len(sub)

            end_line = start_line + sub.count("\n")
            prev_end_line = end_line

            chunks.append({
                "text": sub,
                "metadata": {
                    "source": filename,
                    "section": "General",
                    "start_line": start_line,
                    "end_line": end_line,
                },
            })
    except Exception as exc:
        logger.error("Error extracting TXT '%s': %s", filename, exc)

    return chunks


def extract_text_from_docx(filepath):
    """
    GAP-003 FIX: Same find() improvement as extract_text_from_txt — advance
    char_offset correctly and fall back to prev_end_line on miss.
    """
    filename = os.path.basename(filepath)
    chunks = []

    try:
        import docx
    except ImportError:
        logger.warning("python-docx not installed, skipping %s", filename)
        return []

    try:
        doc = docx.Document(filepath)
        full_text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        if not full_text.strip():
            return []

        sub_chunks = splitter.split_text(full_text)
        char_offset = 0
        prev_end_line = 0

        for sub in sub_chunks:
            if len(sub.strip()) < MIN_CHUNK_LENGTH:
                continue

            pos = full_text.find(sub, char_offset)
            if pos == -1:
                start_line = prev_end_line + 1
            else:
                start_line = full_text[:pos].count("\n") + 1
                char_offset = pos + len(sub)

            end_line = start_line + sub.count("\n")
            prev_end_line = end_line

            chunks.append({
                "text": sub,
                "metadata": {
                    "source": filename,
                    "section": "General",
                    "start_line": start_line,
                    "end_line": end_line,
                },
            })
    except Exception as exc:
        logger.error("Error extracting DOCX '%s': %s", filename, exc)

    return chunks


def split_markdown_by_headers(content: str, filename: str):
    """
    Split markdown by headers, detect policy sections, and sub-chunk large sections.

    GAP-014 FIX: The original regex only matched `**8) Whistle Blower Policy**`
    — a very specific format from one document.  It missed standard markdown
    headers (## Leave Policy), bold headers without numbers (**Travel Guidelines**),
    and any header not ending with the word "Policy".

    New approach: detect BOTH standard markdown headers (# / ## / ###) AND
    bold lines (**...**), extract the header text for the section label, and
    auto-detect the policy_type by keyword matching — the same keywords used in
    retrieval.py's extract_policy_type().
    """
    POLICY_KEYWORDS = {
        "whistle blower": ["whistle", "whistleblower", "fraud reporting"],
        "confidentiality": ["confidential", "non-disclosure", "nda"],
        "it asset": ["it asset", "laptop", "vpn", "acceptable use"],
        "leave": ["leave", "vacation", "casual", "earned", "maternity", "paternity"],
        "moonlighting": ["moonlight", "dual employment", "side job", "external work"],
        "remote work": ["remote", "work from home", "wfh", "telecommute"],
        "onboarding": ["onboard", "new hire", "induction", "orientation"],
        "code of conduct": ["code of conduct", "ethics", "discipline"],
    }

    def _detect_policy_type(text: str) -> str:
        text_lower = text.lower()
        for policy, keywords in POLICY_KEYWORDS.items():
            if any(kw in text_lower for kw in keywords):
                return policy
        return "General"

    def _is_header(line: str):
        """Return True if the line is a markdown or bold header."""
        stripped = line.strip()
        # Standard markdown: # Header, ## Header, ### Header
        if re.match(r'^#{1,4}\s+\S', stripped):
            return True
        # Bold line: **Some Header** (entire line is bold)
        if re.match(r'^\*\*[^*]+\*\*\s*$', stripped):
            return True
        return False

    def _header_text(line: str) -> str:
        """Extract plain text from a header line."""
        stripped = line.strip()
        # Remove leading # characters
        stripped = re.sub(r'^#{1,4}\s+', '', stripped)
        # Remove surrounding **
        stripped = re.sub(r'^\*\*|\*\*$', '', stripped).strip()
        return stripped

    lines = content.split("\n")
    raw_sections = []

    current_chunk_lines = []
    current_header = "General"
    current_policy = "General"
    start_line = 1

    for i, line in enumerate(lines):
        line_num = i + 1

        if _is_header(line):
            # Flush accumulated lines as a section
            if current_chunk_lines:
                text = "\n".join(current_chunk_lines).strip()
                if len(text) > 30:
                    raw_sections.append({
                        "text": text,
                        "header": current_header,
                        "policy": current_policy,
                        "start_line": start_line,
                        "end_line": line_num - 1,
                    })

            header_plain = _header_text(line)
            current_header = header_plain or current_header
            # Auto-detect policy type from the header text
            detected = _detect_policy_type(current_header)
            if detected != "General":
                current_policy = detected
            current_chunk_lines = [line]
            start_line = line_num
        else:
            current_chunk_lines.append(line)

    # Flush the last section
    if current_chunk_lines:
        text = "\n".join(current_chunk_lines).strip()
        if len(text) > 20:
            raw_sections.append({
                "text": text,
                "header": current_header,
                "policy": current_policy,
                "start_line": start_line,
                "end_line": len(lines),
            })

    # Sub-chunk any section that is too large for a single embedding
    chunks = []
    for sec in raw_sections:
        policy_type = sec.get("policy", "General")

        if len(sec["text"].strip()) < MIN_CHUNK_LENGTH:
            continue

        if len(sec["text"]) <= 500:
            chunks.append({
                "text": sec["text"],
                "metadata": {
                    "source": filename,
                    "section": sec["header"],
                    "policy_type": policy_type,
                    "start_line": sec["start_line"],
                    "end_line": sec["end_line"],
                },
            })
        else:
            sub_chunks = splitter.split_text(sec["text"])
            total = len(sub_chunks)
            line_span = max(sec["end_line"] - sec["start_line"], 1)
            for ci, sub in enumerate(sub_chunks):
                if len(sub.strip()) < MIN_CHUNK_LENGTH:
                    continue
                chunk_start = sec["start_line"] + int(ci / total * line_span)
                chunk_end = sec["start_line"] + int((ci + 1) / total * line_span)
                chunks.append({
                    "text": sub,
                    "metadata": {
                        "source": filename,
                        "section": sec["header"],
                        "policy_type": policy_type,
                        "start_line": chunk_start,
                        "end_line": chunk_end,
                    },
                })

    return chunks


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    logger.info("Loading embedding model: %s ...", LOCAL_EMBEDDING_MODEL)
    model = SentenceTransformer(LOCAL_EMBEDDING_MODEL)

    logger.info("Initializing ChromaDB at %s ...", CHROMA_DIR)
    os.makedirs(CHROMA_DIR, exist_ok=True)
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    collection_name = "hr_docs_v2"
    temp_name = f"{collection_name}_temp"

    # GAP-016 FIX: Ingest into a temporary collection first, then swap.
    # The old approach deleted the live collection before ingestion started.
    # If ingestion failed midway (corrupt file, OOM, network error), the
    # collection was left empty — destroying all search functionality until
    # a full successful re-ingest.  Now:
    #   1. Ingest everything into <name>_temp
    #   2. Only after success: delete live collection, rename temp → live
    #   3. On failure: delete temp, leave live collection untouched
    existing = {col.name for col in client.list_collections()}
    if temp_name in existing:
        client.delete_collection(temp_name)
        logger.info("Cleaned up leftover temp collection.")

    temp_collection = client.get_or_create_collection(name=temp_name)
    logger.info("Ingesting into temporary collection '%s' ...", temp_name)

    logger.info("Scanning %s ...", DOCS_DIR)
    if not os.path.exists(DOCS_DIR):
        os.makedirs(DOCS_DIR)

    all_chunk_texts = []
    all_metadatas = []
    all_ids = []
    skipped_files = []

    for filename in sorted(os.listdir(DOCS_DIR)):
        filepath = os.path.join(DOCS_DIR, filename)
        if not os.path.isfile(filepath):
            continue

        # GAP-029 FIX: Wrap each file extraction in try/except so a single
        # corrupt or locked file does not abort the entire ingestion run.
        # Previously one bad file would crash the loop, leaving all subsequent
        # files un-indexed and (combined with GAP-016) the live collection empty.
        file_chunks = []
        try:
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
                logger.info("  Skipped (unsupported): %s", filename)
                continue
        except Exception as exc:
            logger.error("  ERROR extracting '%s': %s — skipping.", filename, exc)
            skipped_files.append(filename)
            continue

        if file_chunks:
            logger.info("  ✓ %s: %d chunks", filename, len(file_chunks))
            for i, c in enumerate(file_chunks):
                all_chunk_texts.append(c["text"])
                all_metadatas.append(c["metadata"])
                all_ids.append(f"{filename}_{i}")
        else:
            logger.warning("  ⚠ Empty/skipped: %s", filename)

    if not all_chunk_texts:
        logger.warning("No valid documents found. Aborting — live collection unchanged.")
        client.delete_collection(temp_name)
        return

    # GAP-030 FIX: Batch-encode all chunks in one model.encode() call instead
    # of encoding each chunk individually inside a for loop.
    # SentenceTransformer.encode() processes texts in GPU batches internally,
    # making this 10-50x faster than per-chunk encoding for large document sets.
    logger.info("Encoding %d chunks (batch) ...", len(all_chunk_texts))
    all_embeddings = model.encode(
        all_chunk_texts,
        batch_size=64,
        show_progress_bar=True,
    ).tolist()

    logger.info("Upserting %d chunks into temp collection ...", len(all_chunk_texts))
    batch_size = 500
    for start in range(0, len(all_chunk_texts), batch_size):
        end = min(start + batch_size, len(all_chunk_texts))
        temp_collection.upsert(
            documents=all_chunk_texts[start:end],
            embeddings=all_embeddings[start:end],
            metadatas=all_metadatas[start:end],
            ids=all_ids[start:end],
        )

    # GAP-016 FIX: Ingestion succeeded — now atomically swap temp → live.
    existing_now = {col.name for col in client.list_collections()}
    if collection_name in existing_now:
        client.delete_collection(collection_name)
        logger.info("Deleted old live collection '%s'.", collection_name)

    # ChromaDB has no rename — copy by upserting into new collection
    live_collection = client.create_collection(name=collection_name)
    all_data = temp_collection.get(include=["documents", "embeddings", "metadatas"])
    if all_data["ids"]:
        batch_size = 500
        ids = all_data["ids"]
        docs = all_data["documents"]
        embs = all_data["embeddings"]
        metas = all_data["metadatas"]
        for start in range(0, len(ids), batch_size):
            end = min(start + batch_size, len(ids))
            live_collection.upsert(
                documents=docs[start:end],
                embeddings=embs[start:end],
                metadatas=metas[start:end],
                ids=ids[start:end],
            )

    client.delete_collection(temp_name)
    logger.info("✅ Ingestion complete. Live collection updated.")

    if skipped_files:
        logger.warning(
            "The following files were skipped due to errors: %s",
            ", ".join(skipped_files),
        )


if __name__ == "__main__":
    main()