import unittest

from boekenwurm_ingest import dating, gate, language, spelling
from boekenwurm_ingest.epub import read_epub
from boekenwurm_ingest.tokenize import countable_lemmas, lowercase_vocabulary, tokenize

from fixtures import ENGLISH, MIXED, MODERN_NL, OLD_NL, make_epub


class LanguageTests(unittest.TestCase):
    def test_detects_dutch_and_english(self):
        self.assertEqual(language.detect(MODERN_NL[0])[0], "nl")
        self.assertEqual(language.detect(ENGLISH[0])[0], "en")

    def test_short_text_is_undetermined(self):
        self.assertEqual(language.detect("Hallo daar")[0], "und")

    def test_line_with_translation_is_mixed(self):
        self.assertTrue(language.is_mixed(MIXED[0]))
        self.assertFalse(language.is_mixed(MODERN_NL[1]))


class SpellingTests(unittest.TestCase):
    def words(self, paras):
        return [w for p in paras for w in language.words(p)]

    def test_modern_text_scores_modern(self):
        r = spelling.score(self.words(MODERN_NL))
        self.assertEqual(r.verdict, "modern")
        self.assertEqual(r.old_markers, 0)

    def test_old_text_scores_old(self):
        r = spelling.score(self.words(OLD_NL))
        self.assertEqual(r.verdict, "old")
        self.assertIn("zoo", dict(r.top_markers))

    def test_modern_isch_adjectives_and_zeiden_are_not_old(self):
        for w in ("logisch", "praktisch", "typisch", "zeiden", "zijn", "tussen", "mensen"):
            self.assertFalse(spelling.is_old_form(w), w)
        for w in ("mensch", "visch", "tusschen", "engelsch", "zoo", "oogen"):
            self.assertTrue(spelling.is_old_form(w), w)


class GateTests(unittest.TestCase):
    def test_modern_book_is_accepted_even_if_tagged_english(self):
        r = gate.check_file(make_epub(MODERN_NL, lang="en", dates=[("2019-03-01", "")]), 2026)
        self.assertEqual(r.verdict, "accept")
        self.assertTrue(any("text is Dutch" in x for x in r.reasons))

    def test_gutenberg_release_date_does_not_hide_old_spelling(self):
        path = make_epub(OLD_NL, title="Oud boek", dates=[("2016-03-03", "publication")],
                         identifier="http://www.gutenberg.org/ebooks/12345",
                         front_matter=["Oud boek, door Test Auteur. Amsterdam, uitgegeven in 1912 bij een uitgever."])
        r = gate.check_file(path, 2026)
        self.assertEqual(r.verdict, "reject_old_spelling")
        self.assertEqual(r.date.year, 1912)
        self.assertEqual(r.date.basis, "title-page")
        self.assertFalse(r.usable)

    def test_learner_book_keeps_only_pure_dutch_paragraphs(self):
        paras = ENGLISH * 3 + MODERN_NL + MIXED * 3
        r = gate.check_file(make_epub(paras, lang="en"), 2026)
        self.assertEqual(r.verdict, "accept_partial")
        self.assertEqual(r.dutch_paragraphs, len(MODERN_NL))  # mixed lines dropped

    def test_english_book_is_rejected(self):
        r = gate.check_file(make_epub(ENGLISH * 3, lang="en"), 2026)
        self.assertEqual(r.verdict, "reject_not_dutch")

    def test_headings_and_nav_are_not_paragraphs(self):
        book = read_epub(make_epub(MODERN_NL))
        self.assertFalse(any("Inhoud" in b.text for b in book.blocks))  # nav skipped
        self.assertTrue(book.blocks[0].is_heading)

    def test_original_publication_event_wins(self):
        path = make_epub(MODERN_NL, dates=[("2021-01-01", "publication"), ("1998", "original-publication")])
        est = dating.estimate(read_epub(path), 2026)
        self.assertEqual((est.year, est.basis), (1998, "original-publication"))


class TokenizeTests(unittest.TestCase):
    def test_names_numbers_and_sentence_starts(self):
        texts = ["Sanne koopt 3 broden bij Jansen. Morgen gaat zij naar Utrecht.", "morgen is het zaterdag."]
        vocab = lowercase_vocabulary(texts)
        toks = tokenize(texts[0], vocab)
        kinds = {t.t: t.k for t in toks if t.k != "punct"}
        self.assertEqual(kinds["Jansen"], "name")
        self.assertEqual(kinds["Utrecht"], "name")
        self.assertEqual(kinds["3"], "number")
        self.assertEqual(kinds["Morgen"], "word")   # sentence start, and "morgen" occurs lowercase
        self.assertEqual(kinds["Sanne"], "word")    # sentence start: not judged as a name
        self.assertNotIn("utrecht", countable_lemmas(toks))
        self.assertEqual(texts[0][toks[0].s:toks[0].e], "Sanne")


if __name__ == "__main__":
    unittest.main()
