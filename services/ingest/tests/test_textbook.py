"""Textbook parsing, on a word list written for this test (no textbook content)."""
import unittest

from boekenwurm_ingest import textbook

SYNTHETIC_LIST = """Woordenlijst
A
appel: apple, een ~ per dag: an apple a day
avond: evening, 's avonds: in the evening / vanavond:
tonight
B
bakker: baker, naar de ~ gaan: go to the baker’s
bloem: flower, een bos bloemen: a bunch of flowers / de
tuin staat vol bloemen: the garden is full of flowers
brood: [het], bread
F
fiets: bicycle, op de ~: by bike
fietsen: cycle, ride a bicycle
K
kleden (zich): dress, get dressed
koken: cook; boil
Mijn Testboek
F230
"""


class WordListTests(unittest.TestCase):
    def setUp(self):
        self.entries = textbook.parse_wordlist(SYNTHETIC_LIST, running_heads=("Mijn Testboek",))
        self.by = {e.base: e for e in self.entries}

    def test_all_headwords_found_and_wrapped_example_not_a_headword(self):
        self.assertEqual([e.base for e in self.entries],
                         ["appel", "avond", "bakker", "bloem", "brood", "fiets", "fietsen", "kleden", "koken"])

    def test_short_gloss_article_and_reflexive(self):
        self.assertEqual(self.by["appel"].gloss, "apple")
        self.assertEqual(self.by["brood"].article, "het")
        self.assertEqual(self.by["brood"].gloss, "bread")
        self.assertTrue(self.by["kleden"].reflexive)
        self.assertEqual(self.by["koken"].gloss, "cook; boil")

    def test_continuation_lines_stay_with_their_entry(self):
        self.assertIn("full of flowers", self.by["bloem"].full)
        self.assertIn("tonight", self.by["avond"].full)


class ContentsTests(unittest.TestCase):
    def test_contents_page_and_chapter_ranges(self):
        toc = ("INHOUD\nHoofdstuk 1 .......... A7\nHoofdstuk 2 .......... A17\n"
               "Grammatica .......... C30\nWoordenlijst .......... F40\n")
        chapters, sections = textbook.find_contents([toc])
        self.assertEqual(chapters, {1: 7, 2: 17})
        self.assertEqual(sections["Woordenlijst"], 40)
        self.assertEqual(textbook.chapter_ranges(chapters, sections, 50), {1: (7, 16), 2: (17, 29)})


class FormsTests(unittest.TestCase):
    def test_regular_verb_forms(self):
        self.assertTrue({"loop", "loopt", "gelopen"} & textbook.forms("lopen"))
        self.assertIn("zit", textbook.forms("zitten"))
        self.assertIn("fietst", textbook.forms("fietsen"))
        self.assertIn("maakt", textbook.forms("maken"))

    def test_first_chapter_tagging(self):
        entries = textbook.parse_wordlist(SYNTHETIC_LIST)
        pages = ["", "Ik koop een appel.", "Zij fietst naar de bakker.", "De bakker heeft brood."]
        textbook.tag_first_chapter(entries, pages, {1: (2, 2), 2: (3, 4)})
        by = {e.base: e.first_chapter for e in entries}
        self.assertEqual(by["appel"], 1)
        self.assertEqual(by["fietsen"], 2)
        self.assertEqual(by["brood"], 2)
        self.assertIsNone(by["koken"])


if __name__ == "__main__":
    unittest.main()
