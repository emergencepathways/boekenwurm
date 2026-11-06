"""Tell Dutch from English and German by their most frequent function words.

Metadata can't be trusted for this: in the owner's library, Dutch novels
are tagged `en`. Detection runs per paragraph, so learner books that mix
English explanation with Dutch examples still yield their Dutch passages.
"""
from __future__ import annotations

import re

WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*", re.UNICODE)

# Words that are frequent in one language and rare or absent in the others.
FUNCTION_WORDS = {
    "nl": set(
        "de het een en van ik je jij niet dat op te zijn met voor maar er ook naar wat hij zij we wij ze "
        "mijn nog bij uit om aan dit deze wordt werd kan moet wil geen veel heel hoe waar wie omdat "
        "hebben heeft hun jullie haar zich zo dan toen al nu wel".split()
    ),
    "en": set(
        "the and of to a that it with for you he she they this are have not but what which from by be "
        "at would there their his her was were been has had will can do does said".split()
    ),
    "de": set(
        "der und ist nicht ich sie das ein eine mit auf sich auch dem zu den es war für von wird "
        "aber noch nach wie wenn nur oder bei sind hat haben werden".split()
    ),
}


def words(text: str) -> list[str]:
    return WORD.findall(text)


def scores(text: str) -> dict[str, int]:
    toks = [w.lower() for w in words(text)]
    return {lang: sum(1 for t in toks if t in fw) for lang, fw in FUNCTION_WORDS.items()}


def is_mixed(text: str, ratio: float = 0.35) -> bool:
    """True for a Dutch paragraph that also carries English or German, e.g. a line plus its translation."""
    s = scores(text)
    other = s["en"] + s["de"]
    return other >= 2 and other >= ratio * max(s["nl"], 1)


def detect(text: str, min_words: int = 6) -> tuple[str, float]:
    """Return (language, confidence). Language is 'nl', 'en', 'de' or 'und' (undetermined)."""
    toks = [w.lower() for w in words(text)]
    if len(toks) < min_words:
        return "und", 0.0
    scores = {lang: sum(1 for t in toks if t in fw) for lang, fw in FUNCTION_WORDS.items()}
    best = max(scores, key=scores.get)
    total = sum(scores.values())
    if scores[best] == 0:
        return "und", 0.0
    # confidence: winner's share of all function-word hits, scaled by how dense the hits are
    share = scores[best] / total
    density = min(1.0, scores[best] / (len(toks) * 0.25))
    return best, round(share * density, 3)
