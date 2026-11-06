"""Dutch base forms: liep, loopt, gelopen -> lopen; huizen -> huis; grootste -> groot.

Twin of packages/dutch/src/lemma.ts; both pass data/nl/lemma-cases.json.

Two lemmatizers share one interface, `lemmas(text, tokens) -> list[str | None]`:

- RuleLemmatizer: irregular-verb data + inflection rules checked against a
  lexicon (the reader's word list or dictionary). Standard library only.
- SpacyLemmatizer: spaCy's Dutch model (nl_core_news_sm or larger). It reads
  the whole sentence, so it also joins separable verbs that are split up in
  the sentence ("Ze belt haar moeder op" -> opbellen, for both "belt" and
  "op"). Used automatically when spaCy and a Dutch model are installed.
"""
from __future__ import annotations

import json
import os
import re
from collections.abc import Iterable
from functools import lru_cache

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DATA = os.environ.get("BOEKENWURM_DATA", os.path.join(REPO_ROOT, "data", "nl"))
VOWELS = "aeiou"


def _is_vowel(c: str | None) -> bool:
    return c is not None and c in VOWELS


def _at(s: str, i: int) -> str | None:
    return s[i] if -len(s) <= i < len(s) else None


@lru_cache(maxsize=1)
def irregular_data() -> dict:
    with open(os.path.join(DATA, "irregular-verbs.json"), encoding="utf-8") as f:
        return json.load(f)


def restore(x: str) -> list[str]:
    """Undo spelling changes made when an ending was added: zitt -> zit, bom -> boom, huiz -> huis."""
    out: list[str] = []

    def add(s: str) -> None:
        if len(s) >= 2 and s not in out:
            out.append(s)

    def devoice(s: str) -> str:
        return re.sub(r"v$", "f", re.sub(r"z$", "s", s))

    n = len(x)
    if n >= 3 and x[-1] == x[-2] and not _is_vowel(x[-1]):
        add(x[:-1])
    if n >= 2 and not _is_vowel(x[-1]) and _is_vowel(x[-2]) and not _is_vowel(_at(x, -3)) and x[-2] != "i":
        add(devoice(x[:-1] + x[-2] + x[-1]))
        add(x[:-1] + x[-2] + x[-1])
    add(devoice(x))
    add(x)
    return out


def infinitives(stem: str) -> list[str]:
    """Possible infinitives for a verb stem: loop -> lopen, zit -> zitten, lees -> lezen, ga -> gaan."""
    out: list[str] = []

    def add(s: str) -> None:
        if s not in out:
            out.append(s)

    def voice(s: str) -> str:
        return re.sub(r"f$", "v", re.sub(r"s$", "z", s))

    n = len(stem)
    add(stem + "en")
    if re.search(r"[aeiou]$", stem):
        add(stem + "n")
    if stem.endswith("a"):
        add(stem + "an")
    if n >= 3 and _is_vowel(stem[-2]) and stem[-2] == stem[-3] and not _is_vowel(stem[-1]):
        single = stem[: n - 2] + stem[n - 1:]
        add(single + "en")
        add(voice(single) + "en")
    if n >= 2 and not _is_vowel(stem[-1]) and _is_vowel(stem[-2]) and not _is_vowel(_at(stem, -3)):
        add(stem + stem[-1] + "en")
    add(voice(stem) + "en")
    return out


def _rule_candidates(w: str) -> list[str]:
    out: list[str] = []

    def add(xs: Iterable[str]) -> None:
        for x in xs:
            if x and x not in out:
                out.append(x)

    def strip(suffix: str) -> str | None:
        return w[: -len(suffix)] if len(w) > len(suffix) + 1 and w.endswith(suffix) else None

    for suf in ("ten", "den", "te", "de"):
        s = strip(suf)
        if s:
            add(infinitives(s))
    if w.startswith("ge") and re.search(r"[td]$", w) and len(w) > 4:
        add(infinitives(w[2:-1]))
    add(infinitives(w))  # the word itself as a stem first: zit -> zitten, not zi(t) -> zien
    t = strip("t")
    if t:
        add(infinitives(t))
    for suf in ("etjes", "tjes", "pjes", "kjes", "jes", "etje", "tje", "pje", "kje", "je"):
        s = strip(suf)
        if s:
            add(restore(s))
    en = strip("en")
    if en:
        add(restore(en))
    for suf in ("'s", "’s", "s"):
        s = strip(suf)
        if s:
            add([s])
    e = strip("e")
    if e:
        add(restore(e))
    for suf in ("ere", "er", "ste", "st"):
        s = strip(suf)
        if s:
            add(restore(s))
    return out


class RuleLemmatizer:
    name = "rules"

    def __init__(self, lexicon: Iterable[str] | None = None, data: dict | None = None):
        data = data or irregular_data()
        self.lex = {w.lower() for w in lexicon} if lexicon is not None else None
        self.irregular: dict[str, str] = {}
        for inf, forms in data["verbs"].items():
            for f in forms:
                self.irregular.setdefault(f, inf)
        for inf, forms in data["present"].items():
            for f in forms:
                self.irregular[f] = inf
        self.insep = sorted(data["inseparable_prefixes"], key=len, reverse=True)
        self.sep = sorted(data["separable_prefixes"], key=len, reverse=True)

    def irregular_of(self, w: str) -> str | None:
        if w in self.irregular:
            return self.irregular[w]
        for p in self.insep:
            if w.startswith(p) and len(w) > len(p) + 1:
                rest = w[len(p):]
                base = self.irregular.get(rest) or self.irregular.get("ge" + rest)
                if base and not base.startswith(p):
                    return p + base
        for p in self.sep:
            if w.startswith(p) and len(w) > len(p) + 2:
                base = self.irregular.get(w[len(p):])
                if base:
                    return p + base
        return None

    def candidates(self, word: str) -> list[str]:
        w = word.lower()
        out: list[str] = []
        irr = self.irregular_of(w)
        if irr:
            out.append(irr)
        out.append(w)
        for c in _rule_candidates(w):
            if c not in out:
                out.append(c)
        for p in self.sep:
            if w.startswith(p + "ge") and re.search(r"[td]$", w):
                for c in infinitives(w[len(p) + 2:-1]):
                    if p + c not in out:
                        out.append(p + c)
        return out

    def lemma(self, word: str) -> str:
        w = word.lower()
        irr = self.irregular_of(w)
        if irr and (self.lex is None or irr in self.lex or w not in self.lex):
            return irr
        if self.lex is None:
            return w
        for c in self.candidates(w):
            if c in self.lex:
                return c
        return w

    def lemmas(self, text: str, tokens: list) -> list[str | None]:
        return [self.lemma(t.t) if t.k == "word" else None for t in tokens]


class SpacyLemmatizer:
    """Lemmas from spaCy, aligned to our own tokens by character offset.

    Separable verbs: a particle attached with the Universal Dependencies relation
    `compound:prt` is joined to its verb ("belt ... op" -> "opbellen"), and both
    words get the joined lemma, so tapping either one shows the real verb.
    When the lexicon is known and spaCy's lemma isn't in it but the rules find one
    that is, the rules win (spaCy's small model guesses unknown words).
    """

    name = "spacy"

    def __init__(self, nlp, lexicon: Iterable[str] | None = None, rules: RuleLemmatizer | None = None):
        self.nlp = nlp
        self.rules = rules or RuleLemmatizer(lexicon)
        self.lex = self.rules.lex

    def lemmas(self, text: str, tokens: list) -> list[str | None]:
        doc = self.nlp(text)
        by_start: dict[int, str] = {}
        for tok in doc:
            lemma = (tok.lemma_ or tok.text).lower()
            by_start.setdefault(tok.idx, lemma)
        for tok in doc:
            if tok.dep_ == "compound:prt" and tok.head is not tok:
                joined = tok.text.lower() + (tok.head.lemma_ or tok.head.text).lower()
                if self.lex is None or joined in self.lex:
                    by_start[tok.idx] = joined
                    by_start[tok.head.idx] = joined
        out: list[str | None] = []
        for t in tokens:
            if t.k != "word":
                out.append(None)
                continue
            lemma = by_start.get(t.s) or t.t.lower()
            if self.lex is not None and lemma not in self.lex:
                ruled = self.rules.lemma(t.t)
                if ruled in self.lex:
                    lemma = ruled
            out.append(lemma)
        return out


def get_lemmatizer(lexicon: Iterable[str] | None = None, prefer: str = "auto"):
    """spaCy when it and a Dutch model are installed (or prefer='spacy'), otherwise the rules."""
    lexicon = list(lexicon) if lexicon is not None else None
    if prefer in ("auto", "spacy"):
        try:
            import spacy  # type: ignore

            for model in ("nl_core_news_lg", "nl_core_news_md", "nl_core_news_sm"):
                try:
                    return SpacyLemmatizer(spacy.load(model, disable=["ner"]), lexicon)
                except OSError:
                    continue
            if prefer == "spacy":
                raise RuntimeError("spaCy is installed but no Dutch model is: python -m spacy download nl_core_news_sm")
        except ImportError:
            if prefer == "spacy":
                raise RuntimeError("spaCy is not installed: pip install 'boekenwurm-ingest[nlp]'")
    return RuleLemmatizer(lexicon)
