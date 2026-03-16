"""
RAG Quality Evaluation Script
------------------------------
Fires a set of HR questions at the running FastAPI backend,
captures the answer + sources for each, and writes a structured
report to  eval_results_<timestamp>.txt

Usage:
    python eval_rag.py
    python eval_rag.py --base-url http://localhost:8000
    python eval_rag.py --out my_results.txt
"""

import argparse
import textwrap
from datetime import datetime
import requests

QUESTIONS = [
    # Holiday List
    ("Holiday List",  "What holidays does the company observe in 2025?"),
    ("Holiday List",  "When is Diwali in 2025?"),
    ("Holiday List",  "How many public holidays are there in 2025?"),
    ("Holiday List",  "Is Ganesh Chaturthi a company holiday?"),
    # NDA
    ("NDA",           "What is the moonlighting disclosure policy?"),
    ("NDA",           "What happens if I breach the confidentiality policy?"),
    ("NDA",           "For how long does the non-compete clause apply after leaving?"),
    ("NDA",           "Can I publish work-related articles without permission?"),
    ("NDA",           "Who owns inventions I create during employment?"),
    # HR Policy Review
    ("HR Policy",     "How many annual leaves do employees get?"),
    ("HR Policy",     "What documents are required at the time of joining?"),
    ("HR Policy",     "Is there a defined probation period policy?"),
    ("HR Policy",     "What is the notice period for trainees?"),
    ("HR Policy",     "What is missing from the current HR policies?"),
    ("HR Policy",     "What is the POSH policy status?"),
    # Expense
    ("Expense",       "What is the expense reimbursement policy?"),
    ("Expense",       "What expenses can employees claim?"),
    # Cross-doc synthesis
    ("Cross-doc",     "What are all the leave-related policies in the company?"),
    ("Cross-doc",     "Summarise all HR policies currently in place."),
    ("Cross-doc",     "What should a new employee know on their first day?"),
    # Out-of-scope — should be declined
    ("Out-of-scope",  "What is the weather in Pune today?"),
    ("Out-of-scope",  "Who won the IPL last year?"),
]


def ask(base_url, question, timeout=60):
    try:
        r = requests.post(f"{base_url}/api/chat", json={"message": question}, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except requests.exceptions.Timeout:
        return {"answer": "[TIMEOUT]", "sources": [], "steps": []}
    except requests.exceptions.ConnectionError:
        return {"answer": "[CONNECTION ERROR — is uvicorn running?]", "sources": [], "steps": []}
    except Exception as exc:
        return {"answer": f"[ERROR: {exc}]", "sources": [], "steps": []}


def fmt_sources(sources):
    if not sources:
        return "  (no sources)"
    out = []
    for s in sources:
        score = s.get("relevance_score")
        score_str = f"  score={score:.3f}" if score is not None else ""
        out.append(f"  • {s.get('source_file','?')} | {s.get('section','')}{score_str}")
    return "\n".join(out)


def fmt_steps(steps):
    if not steps:
        return "(none)"
    return ", ".join(s.get("name") or s.get("type", "?") for s in steps)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--out", default=None)
    parser.add_argument("--timeout", type=int, default=60)
    args = parser.parse_args()

    out_file = args.out or f"eval_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    SEP = "=" * 80

    print(f"Connecting to {args.base_url} ...")
    try:
        h = requests.get(f"{args.base_url}/api/health", timeout=5)
        health = h.json()
        print(f"  ✓ Server up — chroma={health.get('chroma_exists')}, db={health.get('db_exists')}")
    except Exception as exc:
        print(f"  ✗ Can't reach server: {exc}")
        print("    Run:  python -m uvicorn backend.api:app --port 8000")
        return

    blocks = []
    header = f"{SEP}\nAgenticHRMS RAG Eval  |  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\nDocs: Holiday List, NDA, HR Policy Review, Expense Policy\nQuestions: {len(QUESTIONS)}\n{SEP}"
    blocks.append(header)
    print(header)

    passed = missed = oos_ok = oos_bad = 0

    for i, (cat, q) in enumerate(QUESTIONS, 1):
        print(f"\n[{i:02d}/{len(QUESTIONS)}] {cat}: {q[:65]}...")
        data = ask(args.base_url, q, args.timeout)
        answer  = data.get("answer", "")
        sources = data.get("sources", [])
        steps   = data.get("steps", [])

        lower = answer.lower()
        is_oos = cat == "Out-of-scope"
        refused = any(p in lower for p in ["only assist with hr", "can only assist", "outside my scope", "not related to hr"])
        no_data = any(p in lower for p in ["couldn't find", "could not find", "no relevant", "contact hr", "i don't have"])

        if is_oos and refused:
            grade = "✓ CORRECTLY DECLINED"; oos_ok += 1
        elif is_oos:
            grade = "⚠ SHOULD HAVE DECLINED"; oos_bad += 1
        elif no_data:
            grade = "✗ RETRIEVAL MISS"; missed += 1
        else:
            grade = "✓ ANSWERED"; passed += 1

        wrapped = textwrap.fill(answer, width=76, initial_indent="  ", subsequent_indent="  ")
        block = f"{SEP}\nQ{i:02d} [{cat}]  {grade}\nQ: {q}\nTools: {fmt_steps(steps)}\nSources:\n{fmt_sources(sources)}\n\nAnswer:\n{wrapped}"
        blocks.append(block)
        print(f"  {grade}")
        if sources:
            print(f"  Sources: {', '.join(s.get('source_file','?') for s in sources[:3])}")

    oos_total = sum(1 for c, _ in QUESTIONS if c == "Out-of-scope")
    in_scope  = len(QUESTIONS) - oos_total
    summary = f"\n{SEP}\nSUMMARY\n{SEP}\nTotal questions    : {len(QUESTIONS)}\nIn-scope answered  : {passed} / {in_scope}\nRetrieval misses   : {missed}\nOut-of-scope OK    : {oos_ok} / {oos_total}\n{SEP}"
    blocks.append(summary)
    print(summary)

    with open(out_file, "w", encoding="utf-8") as f:
        f.write("\n\n".join(blocks))
    print(f"\n✅ Saved to: {out_file}")


if __name__ == "__main__":
    main()