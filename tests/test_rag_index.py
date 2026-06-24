"""
tests/test_rag_index.py — BM25 index reliability tests.

Pure file I/O — no database, no HTTP, no server required.
Run with:  pytest tests/test_rag_index.py -v
"""
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_docs_dir(tmp_path: Path, files: dict) -> Path:
    docs = tmp_path / "docs"
    docs.mkdir()
    for name, content in files.items():
        if isinstance(content, bytes):
            (docs / name).write_bytes(content)
        else:
            (docs / name).write_text(content, encoding="utf-8")
    return docs


def _fresh_index(docs_dir: Path):
    """Patch settings.DOCS_DIR and force a module-level reload of the index."""
    import backend.core.config as config_mod

    # Save original and patch
    orig_docs_dir = config_mod.settings.DOCS_DIR
    config_mod.settings.DOCS_DIR = docs_dir

    # Remove cached module so globals (_bm25, _chunks) reset on re-import.
    # The warm-up at the bottom of bm25_index.py will run against docs_dir.
    sys.modules.pop("rag.bm25_index", None)
    import rag.bm25_index as idx

    return idx, orig_docs_dir, config_mod


def _restore(config_mod, orig_docs_dir):
    config_mod.settings.DOCS_DIR = orig_docs_dir
    # Also reload index so it's back to real docs for any subsequent imports
    sys.modules.pop("rag.bm25_index", None)


# BM25 needs enough term overlap to score > 0. Use rich paragraphs.
LEAVE_CONTENT = """
Annual Leave Policy

Every employee is entitled to twenty working days of paid annual leave per
calendar year. Leave entitlement accrues monthly at a rate of 1.67 days per
month. Employees wishing to take annual leave must submit a leave application
to their manager at least two weeks in advance. Unapproved leave will be
treated as leave without pay. Carry-over of unused annual leave is limited to
a maximum of ten days into the following year. Leave entitlement cannot be
encashed except on termination of employment.
""".strip()

CONDUCT_CONTENT = """
Code of Conduct

All employees are required to maintain the highest professional standards of
conduct at all times. Discrimination, harassment, and bullying in any form are
strictly prohibited and may result in disciplinary action including termination.
Employees must treat colleagues, clients, and visitors with dignity and respect.
Any breach of this code must be reported to the Human Resources department.
""".strip()

EXIT_CONTENT = """
Exit Interview Process

Employees who resign or are separated from the company must complete a formal
exit interview with the HR department within the final week of employment.
The exit interview covers reasons for departure, feedback on the work environment,
and handover of responsibilities. The HR team uses exit interview data to improve
retention and organisational culture. Completion of the exit interview is
mandatory and must be scheduled through the HR portal.
""".strip()

ONBOARDING_CONTENT = """
Onboarding Checklist

New employees joining the company must complete a structured onboarding programme
during their first two weeks. This includes attending a company orientation session,
receiving their access cards and IT credentials, completing mandatory compliance
training, and attending a benefits briefing with the HR team. The line manager is
responsible for assigning a buddy and scheduling introductory meetings with key
stakeholders. All onboarding steps must be signed off in the HR system.
""".strip()

REMOTE_CONTENT = """
Remote Work Policy

Employees may work remotely for up to three days per week subject to manager
approval and business requirements. Remote working arrangements must be agreed
in writing before commencement. Employees working remotely are expected to be
available during core hours and to attend all scheduled meetings via video
conference. The company is not liable for home office expenses unless pre-approved.
Remote work privileges may be withdrawn if performance or attendance standards
are not met.
""".strip()

GRIEVANCE_CONTENT = """
Grievance Procedure

Any employee who wishes to raise a formal grievance against a colleague,
manager, or the organisation must submit a written complaint to the Human
Resources department. The HR team will acknowledge receipt within two working
days and initiate a formal investigation. The grievance will be heard by a
senior HR manager who was not involved in the matter. The employee has the
right to be accompanied at any grievance hearing by a colleague or trade union
representative. The outcome will be communicated in writing within ten working
days of the hearing.
""".strip()


# ── Test 1: query returns chunks from the right file ──────────────────────────

def test_search_returns_correct_source_file(tmp_path):
    docs = _make_docs_dir(tmp_path, {
        "leave_policy.txt": LEAVE_CONTENT,
        "code_of_conduct.txt": CONDUCT_CONTENT,
    })
    idx, orig, cfg = _fresh_index(docs)
    try:
        results = idx.search("annual leave entitlement days calendar year")
        assert results, "Expected at least one result for 'annual leave'"
        src = results[0].get("source_file") or results[0].get("source")
        assert src == "leave_policy.txt", f"Expected leave_policy.txt, got {src}"
    finally:
        _restore(cfg, orig)


# ── Test 2: delete a file, rebuild, it disappears from results ────────────────

def test_delete_and_rebuild_removes_file(tmp_path):
    docs = _make_docs_dir(tmp_path, {
        "exit_interview.txt": EXIT_CONTENT,
        "onboarding.txt": ONBOARDING_CONTENT,
    })
    idx, orig, cfg = _fresh_index(docs)
    try:
        before = [r.get("source_file") or r.get("source") for r in
                  idx.search("exit interview HR department resignation departure")]
        assert "exit_interview.txt" in before, \
            f"Expected exit_interview.txt in results before delete, got {before}"

        (docs / "exit_interview.txt").unlink()
        idx.rebuild()

        after = [r.get("source_file") or r.get("source") for r in
                 idx.search("exit interview HR department resignation departure")]
        assert "exit_interview.txt" not in after, \
            "Deleted file still appears in results after rebuild"
    finally:
        _restore(cfg, orig)


# ── Test 3: empty corpus returns [] without raising ───────────────────────────

def test_empty_corpus_returns_empty_list(tmp_path):
    docs = _make_docs_dir(tmp_path, {})
    idx, orig, cfg = _fresh_index(docs)
    try:
        results = idx.search("any query at all")
        assert results == [], f"Expected [], got {results}"
    finally:
        _restore(cfg, orig)


# ── Test 4: corrupt file is skipped, build does not raise ─────────────────────

def test_corrupt_file_is_skipped(tmp_path):
    docs = _make_docs_dir(tmp_path, {
        "good_policy.txt": REMOTE_CONTENT,
        "corrupt_file.txt": b"\xff\xfe\x00\x00\x00\x00",
    })
    idx, orig, cfg = _fresh_index(docs)
    try:
        # warm-up already ran on import — just search
        sources = [r.get("source_file") or r.get("source") for r in
                   idx.search("remote work days manager approval business")]
        assert "good_policy.txt" in sources, \
            f"Good file missing after corrupt-file skip. Sources: {sources}"
        assert "corrupt_file.txt" not in sources
    finally:
        _restore(cfg, orig)


# ── Test 5: source field is a bare filename, no path prefix ──────────────────

def test_source_file_is_bare_filename(tmp_path):
    # Two documents needed: BM25 IDF is 0 when there is only one document
    # (no discrimination), so all scores are 0 and the score-filter drops them.
    # A second file gives BM25 the contrast it needs to produce score > 0.
    docs = _make_docs_dir(tmp_path, {
        "grievance_procedure.txt": GRIEVANCE_CONTENT,
        "leave_policy.txt": LEAVE_CONTENT,
    })
    idx, orig, cfg = _fresh_index(docs)
    try:
        results = idx.search("grievance complaint HR department written formal")
        assert results, "Expected at least one result"
        for r in results:
            src = r.get("source_file") or r.get("source") or ""
            assert "/" not in src and "\\" not in src, \
                f"source contains a path separator: {src!r}"
            assert src == Path(src).name, \
                f"source is not a bare filename: {src!r}"
    finally:
        _restore(cfg, orig)
