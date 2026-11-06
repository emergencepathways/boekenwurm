"""Detect Dutch written in pre-reform spelling.

Dutch spelling changed in 1934/1947 (Marchant) and 1955 (the first Groene
Boekje). Older texts write *zoo, oogen, groote, menschen, tusschen*. Learners
should not pick those forms up, so the import check measures how often such
markers occur per 10,000 Dutch words.

Calibrated on the owner's library (32 EPUBs, November 2026): modern books
scored 0–4.3, every pre-reform book 24 or more, most above 85.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

# Explicit markers: frequent words whose spelling no longer exists today.
# Deliberately excludes forms that are still correct (zeiden, zijne in "de zijne").
OLD_FORMS = {
    # oo / ee in open syllables, now o / e
    "zoo", "zooals", "zoodra", "zoowel", "zoolang", "oogen", "oogenblik", "oogenblikje", "ooren",
    "groote", "grooter", "grootste", "loopen", "koopen", "rooken", "hooren", "boomen", "noodig",
    "heeren", "eenen", "eener", "eenige", "eenigen", "eenigszins", "leeren", "deelen", "beenen",
    "steenen", "meenen", "weenen", "keeren", "veele", "vreezen", "leezen",
    # -sch, now -s
    "mensch", "menschen", "menschelijk", "visch", "vleesch", "tusschen", "wensch", "wenschen",
    "engelsch", "fransch", "duitsch", "hollandsch", "nederlandsch", "frisch", "valsch", "wasch",
    # inflected articles and pronouns that modern Dutch dropped
    "eene", "mijne", "uwe", "hunne", "onzen", "dezen", "welken", "zijnen", "haren",
    # spellings and verb forms that dropped out
    "zeide", "thans", "alsdan", "gaarne", "zóó",
    # y for ij (19th century and earlier)
    "zyn", "myn", "wy", "zy", "hy", "tyd", "blyven", "schryven", "ryk",
}

# Ending rule: nouns and adjectives in -sch (not the modern -isch adjectives).
SCH_EXCEPTIONS = {"bosch", "hertogenbosch", "esch", "marsch"}


def is_old_form(word: str) -> bool:
    w = word.lower()
    if w in OLD_FORMS:
        return True
    return len(w) >= 5 and w.endswith("sch") and not w.endswith("isch") and w not in SCH_EXCEPTIONS


@dataclass
class SpellingReport:
    dutch_words: int
    old_markers: int
    per_10k: float
    top_markers: list[tuple[str, int]]
    verdict: str  # "modern" | "borderline" | "old"


MODERN_MAX = 5.0
BORDERLINE_MAX = 15.0


def score(dutch_words: list[str]) -> SpellingReport:
    n = len(dutch_words)
    hits = Counter(w.lower() for w in dutch_words if is_old_form(w))
    total = sum(hits.values())
    per_10k = round(total / n * 10_000, 1) if n else 0.0
    if per_10k <= MODERN_MAX:
        verdict = "modern"
    elif per_10k <= BORDERLINE_MAX:
        verdict = "borderline"
    else:
        verdict = "old"
    return SpellingReport(n, total, per_10k, hits.most_common(5), verdict)
