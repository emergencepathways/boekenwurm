"""Command line for the ingest service.

  python -m boekenwurm_ingest check BOOK.epub [...]        import check, one line per book
  python -m boekenwurm_ingest check --json BOOK.epub        full reports as JSON
  python -m boekenwurm_ingest paragraphs BOOK.epub OUT.json Dutch paragraphs with tap tokens
  python -m boekenwurm_ingest textbook BOOK.pdf [--out DIR] private word list from your own textbook
"""
from __future__ import annotations

import argparse
import dataclasses
import glob
import json
import os
import sys

from . import gate, textbook
from .tokenize import countable_lemmas, lowercase_vocabulary, to_json, tokenize

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PRIVATE = os.path.join(REPO_ROOT, "private")

LABEL = {
    "accept": "OK",
    "accept_partial": "OK (Dutch parts)",
    "warn_borderline": "WARN",
    "reject_old_spelling": "OLD SPELLING",
    "reject_not_dutch": "NOT DUTCH",
}


def _expand(paths: list[str]) -> list[str]:
    out = []
    for p in paths:
        out += sorted(glob.glob(os.path.join(p, "*.epub"))) if os.path.isdir(p) else [p]
    return out


def cmd_check(args) -> int:
    reports = []
    for path in _expand(args.books):
        try:
            reports.append(gate.check_file(path))
        except Exception as e:  # a broken file shouldn't stop the batch
            print(f"{os.path.basename(path)[:44]:45} ERROR  {e}", file=sys.stderr)
    if args.json:
        json.dump([{k: v for k, v in dataclasses.asdict(r).items() if k != "paragraphs"} for r in reports],
                  sys.stdout, ensure_ascii=False, indent=1, default=str)
        print()
        return 0
    for r in reports:
        year = f"~{r.date.year} ({r.date.basis})" if r.date.year else "unknown"
        print(f"{os.path.basename(r.path)[:44]:45} {LABEL[r.verdict]:17} old={r.spelling.per_10k:6}/10k  "
              f"nl={r.dutch_share:4.0%}  paras={r.dutch_paragraphs:5}  written {year:24} {r.title[:40]}")
        if args.verbose:
            for reason in r.reasons:
                print(" " * 47 + "· " + reason)
    usable = sum(r.usable for r in reports)
    print(f"\n{usable} of {len(reports)} books usable.")
    return 0


def cmd_paragraphs(args) -> int:
    r = gate.check_file(args.book)
    if not r.usable and not args.force:
        print(f"Not usable ({r.verdict}): " + " ".join(r.reasons), file=sys.stderr)
        return 2
    vocab = lowercase_vocabulary([p.text for p in r.paragraphs])
    out = []
    for i, p in enumerate(r.paragraphs):
        toks = tokenize(p.text, vocab)
        out.append({"id": f"p{i:05d}", "block": p.block, "doc": p.doc, "text": p.text,
                    "countable": len(countable_lemmas(toks)), "tokens": to_json(toks)})
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"title": r.title, "verdict": r.verdict, "paragraphs": out}, f, ensure_ascii=False)
    print(f"{len(out)} paragraphs -> {args.out}")
    return 0


def cmd_textbook(args) -> int:
    out = os.path.abspath(args.out)
    inside_repo = out.startswith(REPO_ROOT + os.sep)
    if inside_repo and not out.startswith(PRIVATE + os.sep) and out != PRIVATE:
        print(f"Refusing to write textbook data inside the repo outside private/: {out}", file=sys.stderr)
        return 2
    summary = textbook.extract(args.pdf, out)
    print(json.dumps(summary, indent=1))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="boekenwurm_ingest")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="import check for EPUB files or folders")
    c.add_argument("books", nargs="+")
    c.add_argument("--json", action="store_true")
    c.add_argument("-v", "--verbose", action="store_true")
    c.set_defaults(fn=cmd_check)
    p = sub.add_parser("paragraphs", help="export Dutch paragraphs with tokens")
    p.add_argument("book")
    p.add_argument("out")
    p.add_argument("--force", action="store_true", help="export even if the check rejects the book")
    p.set_defaults(fn=cmd_paragraphs)
    t = sub.add_parser("textbook", help="private word list from a textbook PDF you own")
    t.add_argument("pdf")
    t.add_argument("--out", default=os.path.join(PRIVATE, "textbook"))
    t.set_defaults(fn=cmd_textbook)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
