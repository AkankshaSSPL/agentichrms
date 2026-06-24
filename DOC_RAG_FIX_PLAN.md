# Doc RAG Fix — Vectorless RAG + Clean Doc Management + Kill User Nudges

## Context

The document side runs a **vector RAG**: every upload is embedded with `sentence-transformers`
(`all-MiniLM-L6-v2`) and stored in **ChromaDB** (`data/chroma_db`, collection `hr_policies`); chat
retrieval is a top-k Chroma query in `agent/tools_registry.py:search_policies`. It's heavy
(torch + chromadb), needs a model download, keeps a persistent on-disk index that **drifts** from
`data/docs/`, and there's a second **dead** retriever (`tools/retrieval.py`, only imported by
`test_retrieval.py`). The corpus is tiny (~14 small policy files).

Two corrections from the user drive this work:
1. **No nudges to anyone.** Employees must never be nudged / tipped off that anything is observed.
   Behaviour insight is **admin-only and on-demand** — already implemented by
   `BehaviourAnalysisService` (gated by `behaviour.analyze` = ADMIN only). The **old user-facing nudge
   system** (chat injection + `/pending-nudge` + `BehaviorAlert` ledger) must be removed.
2. **The RAG must be reliable** — rebuild it once, correctly, so we stop messing with it.

Goal: replace the vector stack with a **vectorless, in-memory BM25 RAG** that is rebuilt from
`data/docs/` (single source of truth, never drifts), revamp the Document Library so **admin + HR** can
upload-with-category / delete / re-tag with a clean UX, and rip out user nudges — while **keeping the
`DocumentAccessLog` audit trail**, because the admin behaviour analysis reads it.

### Contracts that MUST be preserved
- `search_policies` keeps its `@tool` name + return shape `{"answer", "sources":[{source_file, section, content}]}`.
  `chat.py:_extract_sources_from_steps` (line 59) filters by tool name `"search_policies"`, and
  `BehaviorService.record_access` maps `source_file` → `DocumentTag.category` for the **audit log**
  (now feeding admin analysis, not nudges). So **`source_file` must equal the on-disk filename**.
- `DocumentAccessLog` writes (`record_access` from chat, `record_view` from the viewer) stay — they're
  read by `BehaviourAnalysisService` via `behavior_repo.list_recent_accesses`.

---

## Part A — Vectorless BM25 RAG (reliable by design)

### A1. Shared extraction/chunking — `rag/extract.py` (new)
Lift the inline logic from `backend/api/docs.py:_ingest_file` (lines 235–275) into reusable, hardened fns:
- `extract_text(path) -> str` — pdf (`pypdf`), docx (`python-docx`), md/txt (`read_text`). Each format
  wrapped in try/except; on failure raise a typed error the caller logs and **skips** (one bad file
  never breaks the whole index).
- `chunk_text(text) -> list[str]` — split on blank-line / markdown-heading boundaries first, fall back
  to a fixed window (`RAG_CHUNK_SIZE`/`RAG_CHUNK_OVERLAP`). Keeps semantic units intact → better recall.

### A2. BM25 index — `rag/bm25_index.py` (new) — the reliability core
Thread-safe singleton (`threading.Lock`); **`data/docs/` is the only source of truth**:
- `build()` — iterate viewable files in `settings.DOCS_DIR`; per file, `extract_text`+`chunk_text` inside
  try/except (skip+log bad files); tokenize (lowercase, `\w+`, small stopword set); build `BM25Okapi`
  over chunk tokens. Keep parallel arrays `chunk_texts / source_files / chunk_indices`. Log
  `"[RAG] indexed N chunks from M docs (S skipped)"`.
- `search(query, k=settings.RAG_TOP_K) -> list[dict]` — tokenize query, `get_scores`, take top-k with
  score > 0; return `[{"source_file", "section": f"Chunk {idx}", "content": text[:500]}]`. Empty corpus
  or no match → `[]` (caller returns a clean "no relevant policy" answer).
- `rebuild()` — re-`build()` under lock (cheap for this corpus); called after every upload/delete.
- Lazy: first `search()` triggers `build()` if empty. Also built at startup (A4) so first query is warm.

### A3. Rewrite the live tool — `agent/tools_registry.py`
- Delete module-level `chromadb` + `SentenceTransformer` setup (lines 15, 19, 37–47) and imports.
- Rewrite `search_policies` (lines 116–153) to call `rag.bm25_index.search()` and assemble the **identical**
  `{"answer", "sources"}` dict (answer = "Based on the following documents:\n\n" + joined chunks; on `[]`
  return the existing "couldn't find any relevant policy" message). Keep decorator/name/signature.

### A4. Startup warm-up — `backend/main.py`
On app startup, call `rag.bm25_index.build()` (wrapped, non-fatal) so the index is ready and logged
before the first request.

### A5. Reliability tests — `tests/test_rag_index.py` (new, pure file I/O, no DB)
Build from a temp docs dir and assert: query finds the expected file; deleting a file + `rebuild()`
removes it from results; empty corpus returns `[]`; a corrupt file is skipped without raising;
`source_file` exactly equals the filename. This is what lets us stop messing with it.

---

## Part B — Document management UI (admin + HR)

### B1. Backend — `backend/api/docs.py`
- `_ingest_file` → replace Chroma embed/upsert (lines 277–306) with `rag.bm25_index.rebuild()`.
  Keep save-to-disk + extraction validation. `"ingested"` now means `"indexed"`.
- `POST /documents/upload` (line 172): add `category: str = Form(DocumentCategory.GENERAL)`; after save +
  rebuild, upsert the tag via `BehaviorService(db).set_tag(filename, category)` (validates the enum).
- `DELETE /documents/{filename}` (new): `require_permission("documents.delete")`; `_safe_resolve`, delete
  file, delete its `DocumentTag` row, `rebuild()`.
- `GET /documents` (line 72): join `DocumentTag` so each entry returns `{filename, category, size_bytes}`
  for badges (use a DB session like `log_document_view` already does).
- **Re-tag reuses the existing endpoint** `PUT /behavior/tags` (`backend/api/behavior_router.py:39` →
  `BehaviorService.set_tag`). No new retag endpoint needed.
- `GET /documents/categories` (new, small): return `DocumentCategory` values+labels so the UI dropdown
  stays in sync with the enum.

### B2. Permissions — `backend/core/permissions.py`
Add `"documents.delete"` to `ADMIN` and `HR` in `ROLE_PERMISSIONS` (lines 56–96), mirroring
`documents.upload`. Re-tag uses the existing permission guarding `PUT /behavior/tags`. (Code-based — **no
DB migration**.)

### B3. Frontend — `useDocuments.js` + `DocumentLibrary.jsx`
Reuse existing design tokens (CSS vars in `frontend/src/index.css`, inline-style convention).
- `useDocuments.js`: `GET /documents` now returns category; `uploadDocument(file, category)` via
  `XMLHttpRequest` for real **progress %**; add `deleteDocument(filename)` and
  `updateCategory(filename, category)` (PUT /behavior/tags); keep `hrms_token` auth + `openRaw`/`logView`.
- `DocumentLibrary.jsx`: cards show type **and** category badge; upload modal = file picker + **category
  dropdown** + **progress bar** + clear success/fail; admin/HR per-card **delete** + inline **re-tag**
  dropdown (gate via `canManage = ['hr','admin'].includes(employee.role)`); keep search + type filters;
  tidy empty/loading/error states.

---

## Part C — Remove the user-facing nudge system (keep the audit log)

- `backend/services/behavior_service.py`: in `record_access` (line 107) and `record_view` (line 150)
  **drop the `self._evaluate(...)` call** but keep `log_access(...)`. Delete `_evaluate`, `_raise_nudge`,
  `get_pending_nudges`, `mark_nudge_delivered`, `dismiss_nudge`, `compose_nudge`, `NUDGE_PLAYBOOK`.
  Keep `record_access`, `record_view`, `list_tags`, `set_tag`.
- `backend/api/chat.py`: remove nudge injection (lines 136–151), the `/pending-nudge` (233) and
  `/nudge/{nudge_id}/dismiss` (266) endpoints, and the `NUDGE_PLAYBOOK` import (line 16). Keep the
  `BehaviorService.record_access` call (lines 212–220).
- Frontend: delete `frontend/src/hooks/useNudges.js`; remove its import + usage in `App.jsx`
  (lines 22, 76, 137) and any nudge render.
- Leave the `BehaviorAlert` table / `005_nudge_ledger.py` migration / `nudge_status.py` in place
  (append-only history; don't author a down-migration) but mark the now-orphaned model + threshold
  config (`BEHAVIOR_THRESHOLD_*`, `NUDGE_REPEAT_COOLDOWN_DAYS`) as dead in `CLEANUP_LOG.md`.

---

## Part D — Config & dependency cleanup
- `backend/core/config.py`: remove `EMBEDDING_MODEL`, `RERANK_MODEL`, `CHROMA_DIR`,
  `CHROMA_COLLECTION_NAME` (lines 136–137, 143, 145); add `RAG_TOP_K=3`, `RAG_CHUNK_SIZE=500`,
  `RAG_CHUNK_OVERLAP=100`. Update root `config.py` shim to drop the CHROMA/embedding re-exports.
- `requirements.txt`: remove `chromadb==0.4.22` (34) and `sentence-transformers==2.3.1` (35) → drops
  torch; add `rank-bm25==0.2.2`.
- Delete `tools/retrieval.py` (dead) and rewrite/remove `test_retrieval.py`. Repurpose
  `rag/ingest_docs.py` into a tiny CLI that builds the BM25 index + prints stats (no embeddings), or
  delete if redundant. Note `data/chroma_db/` is now orphaned (gitignore). Log all removals in `CLEANUP_LOG.md`.

## Critical files
`agent/tools_registry.py`, `backend/api/docs.py`, `backend/services/behavior_service.py`,
`backend/api/chat.py`, `backend/core/permissions.py`, `backend/core/config.py` + root `config.py`,
`requirements.txt`, `frontend/src/components/DocumentLibrary.jsx`, `frontend/src/hooks/useDocuments.js`,
`frontend/src/App.jsx`. New: `rag/extract.py`, `rag/bm25_index.py`, `tests/test_rag_index.py`.
Reused as-is: `backend/api/behavior_router.py` (`PUT /tags`), `agent/agent.py:114` (tool wiring).

## Out of scope
Per-role document **visibility** (all authenticated users still see/query all docs). Postgres FTS / new
chunk tables (in-memory BM25 chosen; no Alembic migration needed).

---

## Verification (no DB run required — per project constraint)
1. **BM25 smoke** (file I/O only): `python -c "from rag.bm25_index import search; print(search('leave policy'))"`
   → chunks from `leave_policy.md`, correct `source_file`/`section`.
2. **Index tests**: `pytest tests/test_rag_index.py` — relevance, delete-reflects, empty, bad-file-skip.
3. **Import check**: `python -c "import agent.tools_registry, backend.api.docs, backend.api.chat"` — no
   chromadb/torch errors, no leftover nudge imports.
4. **Tool contract**: `search_policies.invoke({'query':'remote work'})` → `{"answer", "sources":[...]}`.
5. **Endpoints** (when a server is up): upload+category → shows in `GET /documents` with badge; chat
   retrieves it; delete removes file+tag+index entry; re-tag via PUT /behavior/tags updates badge.
6. **No-nudge regression**: chat about a POSH/EXIT doc → a `DocumentAccessLog` row IS written (admin
   analysis sees it) but **no** nudge appears to the user and `/chat/pending-nudge` no longer exists.
7. **Frontend**: `cd frontend && npm run build` (+ lint) clean; manual upload-progress/delete/re-tag as
   HR/admin, read-only as employee, and confirm no nudge UI renders.
