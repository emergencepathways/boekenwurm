"""Turn a course textbook PDF the user owns into a private word list.

The textbook is copyrighted. This module contains no textbook content: it
reads the PDF the user points it at and writes its results under the
gitignored `private/` folder (or wherever the user chooses outside the repo).

What it extracts
  wordlist.json   every headword of the book's alphabetical word list, with
                  its English gloss, article ([het]) and reflexive marker
  chapters.json   page ranges of the numbered chapters, from the contents page
  seed.json       for each headword, the first chapter whose text uses it;
                  "I'm at chapter 13" then marks chapters 1-13 as probably known

Layout assumptions (checked against the owner's course textbook; other
books can be supported by passing their own section names):
  - the contents page lists "Hoofdstuk N ..... A7" and "Woordenlijst .... F221"
  - page labels equal physical page numbers
  - word-list entries look like "headword: gloss, example: translation / ..."
Requires `pdftotext` (poppler-utils).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import unicodedata
from collections import defaultdict
from dataclasses import asdict, dataclass

TOC_CHAPTER = re.compile(r"Hoofdstuk\s*(\d+)\s*\.{2,}\s*[A-Z]\s*(\d+)")
TOC_SECTION = re.compile(r"^(?P<name>[A-Z][^\n.]{2,40}?)\s*\.{2,}\s*(?P<label>[A-Z])\s*(?P<page>\d+)\s*$", re.M)
ENTRY = re.compile(r"^(?P<head>[^\W\d_][^:]{0,60}?):\s*(?P<gloss>.*)$", re.UNICODE)
PAGE_LABEL = re.compile(r"^[A-Z]?\d{1,3}$")
WORD = re.compile(r"[^\W\d_]+(?:['’-][^\W\d_]+)*", re.UNICODE)


@dataclass
class Entry:
    headword: str          # as printed ("aankleden (zich)", "aanwezig/heid")
    base: str              # lookup form ("aankleden", "aanwezig")
    article: str | None    # "het" when marked [het], else None
    reflexive: bool
    gloss: str             # short English meaning
    full: str              # the whole entry text, examples included
    first_chapter: int | None = None


def pdf_pages(pdf: str) -> list[str]:
    try:
        out = subprocess.run(["pdftotext", "-enc", "UTF-8", pdf, "-"], check=True, capture_output=True).stdout
    except FileNotFoundError as e:
        raise RuntimeError("pdftotext not found; install poppler-utils") from e
    return out.decode("utf-8", "replace").split("\f")


def find_contents(pages: list[str], scan: int = 12) -> tuple[dict[int, int], dict[str, int]]:
    """Chapter start pages and named section start pages from the contents pages."""
    chapters: dict[int, int] = {}
    sections: dict[str, int] = {}
    for p in pages[:scan]:
        flat = re.sub(r"[ \t]+", " ", p)
        for n, page in TOC_CHAPTER.findall(flat):
            chapters.setdefault(int(n), int(page))
        for m in TOC_SECTION.finditer(flat):
            name = m.group("name").strip()
            if not name.lower().startswith("hoofdstuk"):
                sections.setdefault(name, int(m.group("page")))
    return chapters, sections


def chapter_ranges(chapters: dict[int, int], sections: dict[str, int], n_pages: int) -> dict[int, tuple[int, int]]:
    """Inclusive (first, last) page for each chapter; a chapter ends where the next chapter or section starts."""
    starts = sorted(set(chapters.values()) | set(sections.values()) | {n_pages + 1})
    ranges = {}
    for n, first in sorted(chapters.items()):
        nxt = min(s for s in starts if s > first)
        ranges[n] = (first, nxt - 1)
    return ranges


def _clean_line(line: str) -> str:
    return line.replace("­", "").replace("ﬁ", "fi").replace("ﬂ", "fl").replace("ﬀ", "ff").strip()


def _fold(s: str) -> str:
    """Sort key for alphabetical-order checks: lowercase, accents and punctuation removed."""
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if c.isalpha())


def _looks_like_headword(head: str) -> bool:
    """Short, and free of the markers that only appear inside examples (~ and a spaced " / ")."""
    return bool(head) and "~" not in head and " / " not in head and len(head.split()) <= 3


def _non_decreasing_subsequence(keys: list[str]) -> set[int]:
    """Indices of a longest non-decreasing subsequence of keys (patience sorting, O(n log n))."""
    import bisect

    tails: list[str] = []       # smallest tail key of a run of each length
    tail_idx: list[int] = []
    parent = [-1] * len(keys)
    for i, k in enumerate(keys):
        pos = bisect.bisect_right(tails, k)
        if pos == len(tails):
            tails.append(k)
            tail_idx.append(i)
        else:
            tails[pos] = k
            tail_idx[pos] = i
        parent[i] = tail_idx[pos - 1] if pos else -1
    keep, i = set(), tail_idx[-1] if tail_idx else -1
    while i != -1:
        keep.add(i)
        i = parent[i]
    return keep


def parse_wordlist(text: str, running_heads: tuple[str, ...] = ()) -> list[Entry]:
    """Parse "headword: gloss" entries; continuation lines join the previous entry.

    Two passes. First every line that could start an entry is marked. Example
    sentences that wrap onto a new line can look like entries too ("huis: house"),
    so the second pass keeps only the longest run of candidates whose first letters
    never go backwards; the printed list is alphabetical by first letter, a wrapped
    example usually is not. Only first letters are compared, because lists are not
    always strictly sorted within a letter.
    """
    lines: list[str] = []
    candidate: list[bool] = []
    for raw in text.splitlines():
        line = _clean_line(raw)
        if not line or line in running_heads or PAGE_LABEL.match(line) or re.fullmatch(r"[A-Z]", line):
            continue
        if line.lower() == "woordenlijst":
            continue
        m = ENTRY.match(line)
        prev_open = bool(lines) and lines[-1].rstrip().endswith((",", "/", "~"))
        candidate.append(bool(m) and not line.startswith(("(", "~", "/")) and not prev_open
                         and _looks_like_headword(m.group("head").strip()))
        lines.append(line)

    cand_idx = [i for i, c in enumerate(candidate) if c]
    keys = [_fold(lines[i].split(":", 1)[0])[:1] or "~" for i in cand_idx]
    starts = {cand_idx[j] for j in _non_decreasing_subsequence(keys)}

    entries: list[list[str]] = []
    for i, line in enumerate(lines):
        if i in starts:
            entries.append([line])
        elif entries:
            entries[-1].append(line)
    return [_entry(" ".join(parts)) for parts in entries]


def _entry(full: str) -> Entry:
    full = re.sub(r"\s+", " ", full).strip()
    head, _, gloss = full.partition(":")
    head = head.strip()
    reflexive = "(zich)" in head
    base = re.sub(r"\(.*?\)", "", head).split("/")[0].strip()
    gloss = gloss.strip()
    article = None
    m = re.match(r"\[(het|de)\],?\s*", gloss)
    if m:
        article, gloss = m.group(1), gloss[m.end():]
    # Short gloss: up to the first example (", word ..." or " / ...")
    short = re.split(r",\s+(?=[^\W\d_]*\s*[~’'(]|[^,]*:)|\s/\s", gloss, maxsplit=1)[0].strip(" ,;")
    return Entry(head, base.lower(), article, reflexive, short, full)


def forms(base: str) -> set[str]:
    """Cheap inflection guesses for matching a headword in running text."""
    b = base.lower()
    out = {b, b + "s", b + "e", b + "en", b + "je", b + "tje"}
    if b.endswith("en") and len(b) > 4:  # verbs: lopen -> loop, loopt, liep (irregular forms missed)
        stem = b[:-2]
        if len(stem) >= 2 and stem[-1] == stem[-2]:
            stem = stem[:-1]               # zitten -> zit
        elif len(stem) >= 2 and stem[-1] not in "aeiou" and stem[-2] in "aeiou" and (len(stem) < 3 or stem[-3] not in "aeiou"):
            stem = stem[:-2] + stem[-2] * 2 + stem[-1]  # lopen -> loop, maken -> maak
        stem = re.sub(r"v$", "f", re.sub(r"z$", "s", stem))
        out |= {stem, stem + "t", stem + "te", stem + "ten", stem + "de", stem + "den", "ge" + stem + "t", "ge" + stem + "d"}
    return out


def tag_first_chapter(entries: list[Entry], pages: list[str], ranges: dict[int, tuple[int, int]]) -> None:
    chapter_words: dict[int, set[str]] = defaultdict(set)
    for n, (first, last) in ranges.items():
        for p in pages[first - 1:last]:
            chapter_words[n] |= {w.lower() for w in WORD.findall(p)}
    for e in entries:
        fs = forms(e.base) if " " not in e.base else {e.base.split()[0]}
        for n in sorted(chapter_words):
            if fs & chapter_words[n]:
                e.first_chapter = n
                break


def extract(pdf: str, out_dir: str, wordlist_section: str = "Woordenlijst") -> dict:
    pages = pdf_pages(pdf)
    chapters, sections = find_contents(pages)
    if not chapters or wordlist_section not in sections:
        raise RuntimeError(f"Contents page not recognised (chapters={len(chapters)}, sections={sorted(sections)})")
    ranges = chapter_ranges(chapters, sections, len(pages))
    wl_first = sections[wordlist_section]
    wl_text = "\n".join(pages[wl_first - 1:])
    title = next((l.strip() for l in pages[0].splitlines() if l.strip()), "")
    entries = parse_wordlist(wl_text, running_heads=(title,))
    tag_first_chapter(entries, pages, ranges)

    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "wordlist.json"), "w", encoding="utf-8") as f:
        json.dump([asdict(e) for e in entries], f, ensure_ascii=False, indent=1)
    with open(os.path.join(out_dir, "chapters.json"), "w", encoding="utf-8") as f:
        json.dump({str(n): {"first_page": a, "last_page": b} for n, (a, b) in ranges.items()}, f, indent=1)
    seed: dict[str, list[str]] = defaultdict(list)
    for e in entries:
        seed[str(e.first_chapter) if e.first_chapter else "unseen"].append(e.base)
    with open(os.path.join(out_dir, "seed.json"), "w", encoding="utf-8") as f:
        json.dump(seed, f, ensure_ascii=False, indent=1)

    per_chapter = {n: len(seed.get(str(n), [])) for n in sorted(ranges)}
    return {
        "pages": len(pages),
        "chapters": len(ranges),
        "entries": len(entries),
        "with_article": sum(1 for e in entries if e.article),
        "reflexive": sum(1 for e in entries if e.reflexive),
        "tagged": sum(1 for e in entries if e.first_chapter),
        "per_chapter": per_chapter,
        "out_dir": out_dir,
    }
