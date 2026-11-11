"""The open dictionary build, on entries written for this test in wiktextract's format (no downloaded data)."""
import gzip
import json
import os
import tempfile
import unittest

from boekenwurm_ingest import dictionary
from boekenwurm_ingest.cli import main

ENTRIES = [
    {"word": "huis", "lang": "Dutch", "lang_code": "nl", "pos": "noun",
     "head_templates": [{"name": "nl-noun", "args": {"1": "n", "2": "huizen"}, "expansion": "huis n (plural huizen, diminutive huisje n)"}],
     "forms": [{"form": "huizen", "tags": ["plural"]}, {"form": "huisje", "tags": ["diminutive"]}, {"form": "nl-noun", "tags": ["inflection-template"]}],
     "senses": [{"glosses": ["house"]}, {"glosses": ["home"]}]},
    {"word": "fiets", "lang_code": "nl", "pos": "noun",
     "head_templates": [{"name": "nl-noun", "args": {"1": "f"}, "expansion": "fiets f (plural fietsen)"}],
     "forms": [{"form": "fietsen", "tags": ["plural"]}],
     "senses": [{"glosses": ["bicycle"]}]},
    {"word": "fietsen", "lang_code": "nl", "pos": "verb",
     "forms": [{"form": "fietste", "tags": ["past", "singular"]}, {"form": "heeft gefietst", "tags": ["perfect"]}],
     "senses": [{"glosses": ["to cycle, to ride a bicycle"]}]},
    {"word": "lopen", "lang_code": "nl", "pos": "verb",
     "forms": [{"form": "liep", "tags": ["past", "singular"]}, {"form": "gelopen", "tags": ["participle", "past"]}],
     "senses": [{"glosses": ["to walk"]}, {"glosses": ["to run (of a machine)"]}, {"glosses": ["to go"], "tags": ["obsolete"]}]},
    # A form-of entry: points at its lemma, carries no meaning of its own.
    {"word": "loopt", "lang_code": "nl", "pos": "verb",
     "senses": [{"glosses": ["inflection of lopen"], "tags": ["form-of"], "form_of": [{"word": "lopen"}]}]},
    # "was": a form of zijn and a noun of its own; zijn is far more common, so the form wins.
    {"word": "zijn", "lang_code": "nl", "pos": "verb",
     "forms": [{"form": "was", "tags": ["past", "singular"]}, {"form": "is", "tags": ["present"]}],
     "senses": [{"glosses": ["to be"]}]},
    {"word": "was", "lang_code": "nl", "pos": "noun",
     "head_templates": [{"name": "nl-noun", "args": {"1": "m"}, "expansion": "was m (uncountable)"}],
     "senses": [{"glosses": ["laundry"]}]},
    {"word": "bank", "lang_code": "nl", "pos": "noun",
     "head_templates": [{"name": "nl-noun", "args": {"1": "f"}, "expansion": "bank f (plural banken)"}],
     "senses": [{"glosses": ["bench, couch"]}, {"glosses": ["bank (financial institution)"]}]},
    # Left out: names, phrases, other languages, archaic-only words, a very rare word.
    {"word": "Utrecht", "lang_code": "nl", "pos": "name", "senses": [{"glosses": ["a city"]}]},
    {"word": "op en neer", "lang_code": "nl", "pos": "adv", "senses": [{"glosses": ["up and down"]}]},
    {"word": "house", "lang_code": "en", "pos": "noun", "senses": [{"glosses": ["huis"]}]},
    {"word": "mensch", "lang_code": "nl", "pos": "noun", "senses": [{"glosses": ["human"], "tags": ["archaic"]}]},
    {"word": "zwiep", "lang_code": "nl", "pos": "noun", "senses": [{"glosses": ["a switch (rod)"]}]},
]

ZIPF = {"huis": 5.6, "huizen": 4.3, "huisje": 3.6, "fiets": 4.7, "fietsen": 4.2, "fietste": 3.0, "lopen": 5.0,
        "liep": 4.4, "gelopen": 4.0, "loopt": 4.5, "zijn": 7.3, "was": 6.6, "is": 7.2, "bank": 4.8, "zwiep": 0.9}
zipf = lambda w: ZIPF.get(w, 0.0)


class DictionaryTests(unittest.TestCase):
    def setUp(self):
        self.d = dictionary.build(ENTRIES, zipf, built="2026-11-11")
        self.L, self.F = self.d["lemmas"], self.d["forms"]

    def test_meanings_articles_and_frequency(self):
        self.assertEqual(self.L["huis"], ["house; home", "het", "noun", 56])
        self.assertEqual(self.L["fiets"][1], "de")
        self.assertEqual(self.L["bank"][0], "bench, couch; bank (financial institution)")
        self.assertIsNone(self.L["lopen"][1])

    def test_archaic_senses_and_words_are_left_out(self):
        self.assertEqual(self.L["lopen"][0], "to walk; to run (of a machine)")
        self.assertNotIn("mensch", self.L)

    def test_names_phrases_other_languages_and_rare_words_are_left_out(self):
        for w in ("utrecht", "Utrecht", "op en neer", "house", "zwiep"):
            self.assertNotIn(w, self.L)

    def test_forms_point_at_their_lemma(self):
        self.assertEqual(self.F["huizen"], "huis")
        self.assertEqual(self.F["liep"], "lopen")
        self.assertEqual(self.F["gelopen"], "lopen")
        self.assertEqual(self.F["loopt"], "lopen")  # from a form-of entry
        self.assertEqual(self.F["fietste"], "fietsen")
        self.assertNotIn("heeft gefietst", self.F)
        self.assertNotIn("nl-noun", self.F)

    def test_a_form_that_is_also_a_word_goes_to_the_more_common_lemma(self):
        self.assertEqual(self.F["was"], "zijn")  # zijn (7.3) is more common than "was" itself (6.6)
        # "fietsen" is the plural of fiets and a verb of its own; fiets (4.7) is more common than "fietsen" (4.2).
        self.assertEqual(self.F["fietsen"], "fiets")
        # Both stay in the dictionary: tapping "fietste" still finds the verb.
        self.assertIn("fietsen", self.L)
        self.assertIn("was", self.L)

    def test_the_most_common_lemmas_are_kept_first(self):
        # "was" (6.6) is mostly a form of zijn, so it ranks as 5.1 and huis (5.6) is kept before it.
        small = dictionary.build(ENTRIES, zipf, max_lemmas=2)
        self.assertEqual(set(small["lemmas"]), {"zijn", "huis"})
        self.assertNotIn("liep", small["forms"])  # its lemma didn't make the cut

    def test_attribution_and_version(self):
        self.assertEqual(self.d["v"], 1)
        self.assertIn("CC BY-SA 4.0", self.d["attribution"])

    def test_reads_gzipped_jsonl_and_skips_other_languages(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "nl.jsonl.gz")
            with gzip.open(src, "wt", encoding="utf-8") as f:
                for e in ENTRIES:
                    f.write(json.dumps(e) + "\n")
                f.write("not json\n")
            words = [e["word"] for e in dictionary.read_jsonl(src)]
            self.assertIn("huis", words)
            self.assertNotIn("house", words)

    def test_cli_refuses_a_source_that_is_too_small(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "nl.jsonl")
            with open(src, "w", encoding="utf-8") as f:
                f.write("\n".join(json.dumps(e) for e in ENTRIES))
            original = dictionary.wordfreq_zipf
            dictionary.wordfreq_zipf = lambda: zipf
            try:
                self.assertEqual(main(["dictionary", src, os.path.join(tmp, "out.json")]), 2)
                self.assertEqual(main(["dictionary", src, os.path.join(tmp, "out.json"), "--min-lemmas", "3"]), 0)
                with open(os.path.join(tmp, "out.json"), encoding="utf-8") as f:
                    self.assertIn("huis", json.load(f)["lemmas"])
            finally:
                dictionary.wordfreq_zipf = original


if __name__ == "__main__":
    unittest.main()
