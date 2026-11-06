"""Base forms. The shared cases also run in packages/dutch, so both twins stay identical."""
import json
import os
import unittest
from types import SimpleNamespace

from boekenwurm_ingest.lemma import DATA, RuleLemmatizer, SpacyLemmatizer, get_lemmatizer
from boekenwurm_ingest.tokenize import tokenize

with open(os.path.join(DATA, "lemma-cases.json"), encoding="utf-8") as f:
    CASES = json.load(f)


class SharedCases(unittest.TestCase):
    def test_with_lexicon(self):
        lem = RuleLemmatizer(CASES["lexicon"])
        for form, expected, why in CASES["cases"]:
            with self.subTest(form=form, why=why):
                self.assertEqual(lem.lemma(form), expected)

    def test_without_lexicon(self):
        lem = RuleLemmatizer()
        for form, expected, why in CASES["no_lexicon"]:
            with self.subTest(form=form, why=why):
                self.assertEqual(lem.lemma(form), expected)


def fake_doc(text, rows):
    """A stand-in for a spaCy Doc: rows are (word, lemma, dep, head_index)."""
    toks, pos = [], 0
    for word, lemma, dep, _ in rows:
        idx = text.index(word, pos)
        pos = idx + len(word)
        toks.append(SimpleNamespace(text=word, lemma_=lemma, dep_=dep, idx=idx, head=None))
    for tok, (_, _, _, head) in zip(toks, rows):
        tok.head = toks[head]
    return toks


class SpacyAdapter(unittest.TestCase):
    TEXT = "Ze belt haar moeder op."
    ROWS = [("Ze", "ze", "nsubj", 1), ("belt", "bellen", "ROOT", 1), ("haar", "haar", "nmod:poss", 3),
            ("moeder", "moeder", "obj", 1), ("op", "op", "compound:prt", 1), (".", ".", "punct", 1)]

    def test_split_separable_verb_is_joined_for_both_words(self):
        nlp = lambda text: fake_doc(text, self.ROWS)
        lem = SpacyLemmatizer(nlp, lexicon=["opbellen", "moeder", "ze", "haar", "bellen"])
        toks = tokenize(self.TEXT, set())
        got = dict(zip([t.t for t in toks], lem.lemmas(self.TEXT, toks)))
        self.assertEqual(got["belt"], "opbellen")
        self.assertEqual(got["op"], "opbellen")
        self.assertEqual(got["moeder"], "moeder")

    def test_joined_verb_needs_the_lexicon_to_know_it(self):
        nlp = lambda text: fake_doc(text, self.ROWS)
        lem = SpacyLemmatizer(nlp, lexicon=["bellen", "moeder"])
        toks = tokenize(self.TEXT, set())
        got = dict(zip([t.t for t in toks], lem.lemmas(self.TEXT, toks)))
        self.assertEqual(got["belt"], "bellen")

    def test_rules_fall_back_when_spacy_is_missing(self):
        self.assertEqual(get_lemmatizer(["lopen"]).name, "rules" if not _has_spacy() else "spacy")


def _has_spacy():
    try:
        import spacy  # noqa: F401
        return True
    except ImportError:
        return False


if __name__ == "__main__":
    unittest.main()
