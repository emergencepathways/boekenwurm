"""Estimate when a text was written. A supporting signal only.

The `dc:date` field usually holds the date of the ebook edition, not of the
text: Project Gutenberg books carry their release date (2005–2025) even for
texts from 1906. So:

- Gutenberg books: ignore `dc:date`, read the years on the title page.
- Other books: `dc:date` (or an `original-publication` event) is used, but
  marked as possibly the edition date.

The spelling check decides acceptance. Dating only adds a note, or turns a
borderline spelling score into a warning when the text is clearly pre-1955.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .epub import Book

YEAR = re.compile(r"(?<!\d)(1[5-9]\d\d|20\d\d)(?!\d)")
GUTENBERG_NOISE = re.compile(r"gutenberg|release|ebook|e-book|updated|posted|produced|license", re.I)
SPELLING_REFORM_YEAR = 1955


@dataclass
class DateEstimate:
    year: int | None
    basis: str  # "title-page", "original-publication", "metadata-edition", "none"
    is_gutenberg: bool
    candidates: list[int] = field(default_factory=list)
    note: str = ""


def is_gutenberg(book: Book) -> bool:
    hay = " ".join(book.meta.identifiers + book.meta.sources + [book.meta.publisher])
    return "gutenberg" in hay.lower()


def _years(s: str, current_year: int) -> list[int]:
    return [int(y) for y in YEAR.findall(s) if 1500 <= int(y) <= current_year]


def title_page_years(book: Book, current_year: int, max_blocks: int = 40) -> list[int]:
    """Years in the front matter, skipping Gutenberg boilerplate lines."""
    found: list[int] = []
    for b in book.blocks[:max_blocks]:
        if GUTENBERG_NOISE.search(b.text):
            continue
        found += _years(b.text, current_year)
    return found


def estimate(book: Book, current_year: int) -> DateEstimate:
    gut = is_gutenberg(book)
    original = [d for d in book.meta.dates if "original" in d.event.lower()]
    if original:
        ys = _years(original[0].value, current_year)
        if ys:
            return DateEstimate(ys[0], "original-publication", gut, ys)

    front = title_page_years(book, current_year)
    if gut:
        if front:
            # Title pages also mention years in titles ("in het jaar 1632"); the latest
            # year before the 20th-century Gutenberg era is the likeliest edition year.
            pre = [y for y in front if y < 1990]
            if pre:
                return DateEstimate(max(pre), "title-page", gut, sorted(set(front)),
                                    "Project Gutenberg text; dc:date is the ebook release date and was ignored.")
        return DateEstimate(None, "none", gut, sorted(set(front)),
                            "Project Gutenberg text with no year on the title page; written date unknown.")

    meta_years = [y for d in book.meta.dates for y in _years(d.value, current_year)]
    if meta_years:
        return DateEstimate(min(meta_years), "metadata-edition", gut, sorted(set(meta_years + front)),
                            "From dc:date, which is often the ebook edition date rather than the writing date.")
    if front:
        return DateEstimate(max(front), "title-page", gut, sorted(set(front)))
    return DateEstimate(None, "none", gut)
