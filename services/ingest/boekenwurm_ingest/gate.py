"""The import check: may this book be used for reading challenges?

Order of evidence, strongest first:
  1. The text itself: which paragraphs are Dutch, and is the Dutch modern?
  2. The estimated date: only a supporting note.

Verdicts
  accept               modern Dutch book
  accept_partial       mostly another language (a learner book); its Dutch
                       paragraphs are usable
  warn_borderline      a few old forms; usable after the reader confirms
  reject_old_spelling  pre-reform spelling; a modernised edition can be
                       offered later (see docs/DESIGN.md, "Old books")
  reject_not_dutch     no usable Dutch text
"""
from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field

from . import dating, language, spelling
from .epub import Block, Book, read_epub

MIN_PARAGRAPH_WORDS = 8       # shorter blocks are headings, captions, list fragments
MIN_DUTCH_PARAGRAPHS = 5
PARTIAL_BELOW_SHARE = 0.6     # under 60% Dutch words -> learner/mixed book


@dataclass
class Paragraph:
    block: int
    doc: int
    text: str
    words: int


@dataclass
class GateReport:
    path: str
    title: str
    creators: list[str]
    metadata_languages: list[str]
    verdict: str
    reasons: list[str]
    dutch_share: float
    dutch_paragraphs: int
    dutch_words: int
    spelling: spelling.SpellingReport
    date: dating.DateEstimate
    paragraphs: list[Paragraph] = field(default_factory=list, repr=False)

    @property
    def usable(self) -> bool:
        return self.verdict in ("accept", "accept_partial", "warn_borderline")


def dutch_paragraphs(blocks: list[Block]) -> tuple[list[Paragraph], int, int]:
    """Return (Dutch paragraphs, Dutch words, all words in candidate paragraphs)."""
    paras: list[Paragraph] = []
    nl_words = all_words = 0
    for b in blocks:
        if b.is_heading:
            continue
        ws = language.words(b.text)
        if len(ws) < MIN_PARAGRAPH_WORDS:
            continue
        all_words += len(ws)
        lang, _ = language.detect(b.text)
        # Mixed paragraphs (a Dutch line with its translation) would give the answers away.
        if lang == "nl" and not language.is_mixed(b.text):
            nl_words += len(ws)
            paras.append(Paragraph(b.index, b.doc, b.text, len(ws)))
    return paras, nl_words, all_words


def check_book(book: Book, current_year: int | None = None) -> GateReport:
    year_now = current_year or _dt.date.today().year
    paras, nl_words, all_words = dutch_paragraphs(book.blocks)
    share = round(nl_words / all_words, 3) if all_words else 0.0
    spell = spelling.score([w for p in paras for w in language.words(p.text)])
    date = dating.estimate(book, year_now)
    reasons: list[str] = []

    meta_langs = [l.lower()[:2] for l in book.meta.languages]
    if meta_langs and "nl" not in meta_langs and share >= PARTIAL_BELOW_SHARE:
        reasons.append(f"Metadata says language '{', '.join(book.meta.languages)}', but the text is Dutch.")

    if len(paras) < MIN_DUTCH_PARAGRAPHS:
        verdict = "reject_not_dutch"
        reasons.append(f"Only {len(paras)} Dutch paragraphs of {MIN_PARAGRAPH_WORDS}+ words found.")
    elif spell.verdict == "old":
        verdict = "reject_old_spelling"
        top = ", ".join(f"{w}×{n}" for w, n in spell.top_markers[:3])
        reasons.append(f"Old spelling: {spell.per_10k} markers per 10,000 Dutch words ({top}).")
    elif spell.verdict == "borderline":
        verdict = "warn_borderline"
        reasons.append(f"Some old spelling: {spell.per_10k} markers per 10,000 Dutch words.")
    elif share < PARTIAL_BELOW_SHARE:
        verdict = "accept_partial"
        reasons.append(f"Only {share:.0%} of the text is Dutch; the {len(paras)} Dutch paragraphs can be used.")
    else:
        verdict = "accept"

    if date.year and date.year < dating.SPELLING_REFORM_YEAR:
        if verdict == "warn_borderline":
            reasons.append(f"Probably written around {date.year}, before the 1955 spelling reform.")
        elif verdict in ("accept", "accept_partial"):
            reasons.append(f"Date suggests {date.year}, but the spelling is modern (a modernised edition?).")
    if date.note:
        reasons.append(date.note)

    return GateReport(book.path, book.meta.title, book.meta.creators, book.meta.languages, verdict, reasons,
                      share, len(paras), nl_words, spell, date, paras)


def check_file(path: str, current_year: int | None = None) -> GateReport:
    return check_book(read_epub(path), current_year)
