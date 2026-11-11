"""The open Dutch dictionary that ships with the app.

Built from two openly licensed sources (both CC BY-SA 4.0, attributed in the app under Me → About):

- English Wiktionary's Dutch entries, as extracted by wiktextract (kaikki.org): English meanings, the article
  (de/het) for nouns, and the inflected forms of each word (liep, gelopen -> lopen; huizen -> huis).
- wordfreq: how common each word is in Dutch (Zipf scale: 7 is "de", 3 is a word met about once per million).

The result is one small JSON file: the most common lemmas with a short meaning, and a map from inflected forms
to their lemma. Frequency also gives a rough difficulty per word.

    python -m boekenwurm_ingest dictionary KAIKKI_DUTCH.jsonl[.gz] OUT.json [--max-lemmas 40000]

Pure functions take the frequency lookup as an argument, so the tests run without wordfreq installed.
"""
from __future__ import annotations

import datetime as _dt
import gzip
import json
import re
from collections.abc import Callable, Iterable, Iterator

Zipf = Callable[[str], float]

# Parts of speech a reader taps in running text. Names, affixes, letters and phrases are left out.
POS = {
    "noun", "verb", "adj", "adv", "prep", "pron", "conj", "det", "article", "num", "intj", "particle",
    "postp", "contraction",
}
# Senses that would teach the wrong thing to a learner of modern Dutch.
SKIP_SENSE_TAGS = {"obsolete", "archaic", "dated", "misspelling", "nonstandard", "rare", "alt-of", "abbreviation"}
# Inflection-table metadata that wiktextract lists among the forms.
SKIP_FORM_TAGS = {"table-tags", "inflection-template", "class", "romanization", "auxiliary"}

# How much lower a word ranks when it is mostly a form of another word (in Zipf units: 1.5 is about 30× rarer).
SHADOW_PENALTY = 1.5

WORD_RE = re.compile(r"^[^\W\d_]+(?:['’-][^\W\d_]+)*$")
GENDER_RE = re.compile(r"^\S+\s+(m|f|n|c|m or f|f or m)\b")

ATTRIBUTION = (
    "Meanings and word forms from Wiktionary (https://en.wiktionary.org), extracted by wiktextract "
    "(https://kaikki.org), CC BY-SA 4.0. Word frequencies from wordfreq (https://github.com/rspeer/wordfreq), "
    "CC BY-SA 4.0. This dictionary file is shared under CC BY-SA 4.0."
)


def read_jsonl(path: str) -> Iterator[dict]:
    """Entries from a wiktextract JSONL file (plain or .gz). Only Dutch entries are passed on."""
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as f:
        for line in f:
            if '"lang_code": "nl"' not in line and '"lang_code":"nl"' not in line:
                continue  # cheap skip, so the full multilingual export can be streamed too
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("lang_code") == "nl":
                yield e


def article(entry: dict) -> str | None:
    """'de' or 'het' for a noun, from its tags or its headword line ("huis n (plural huizen)")."""
    if entry.get("pos") != "noun":
        return None
    tags = set(entry.get("tags", []))
    for s in entry.get("senses", []):
        tags |= set(s.get("tags", []))
    genders = set()
    for t in entry.get("head_templates", []):
        args = t.get("args", {})
        for k in ("1", "g", "g2"):
            v = str(args.get(k, ""))
            genders |= {g for g in re.split(r"[-,\s]+", v) if g in {"m", "f", "n", "c"}}
        m = GENDER_RE.match(t.get("expansion", ""))
        if m:
            genders |= set(re.findall(r"[mfnc]", m.group(1)))
    if "neuter" in tags:
        genders.add("n")
    if tags & {"masculine", "feminine", "common"}:
        genders.add("c")
    if genders == {"n"}:
        return "het"
    if genders and "n" not in genders:
        return "de"
    return None  # both (de/het) or unknown: better no article than a wrong one


def meaning(entry: dict, max_len: int = 110) -> str | None:
    """The first few modern senses, joined: 'to walk; to run'. None when every sense is a form-of or archaic."""
    glosses: list[str] = []
    for s in entry.get("senses", []):
        tags = set(s.get("tags", []))
        if "form-of" in tags or s.get("form_of") or tags & SKIP_SENSE_TAGS:
            continue
        for g in s.get("glosses", [])[-1:]:  # the last gloss is the specific one; earlier ones are parent senses
            g = re.sub(r"\s+", " ", g).strip().rstrip(".")
            if g and g not in glosses:
                glosses.append(g)
        if len(glosses) >= 3:
            break
    if not glosses:
        return None
    out = glosses[0]
    for g in glosses[1:]:
        if len(out) + 2 + len(g) > max_len:
            break
        out += "; " + g
    return out if len(out) <= max_len else out[: max_len - 1].rstrip() + "…"


def forms_of(entry: dict) -> Iterator[tuple[str, str]]:
    """(form, lemma) pairs: the forms listed under a lemma, and 'form-of' senses pointing at a lemma."""
    word = entry.get("word", "")
    for f in entry.get("forms", []):
        form = f.get("form", "")
        if not form or set(f.get("tags", [])) & SKIP_FORM_TAGS:
            continue
        if WORD_RE.match(form) and form.lower() != word.lower():
            yield form.lower(), word.lower()
    for s in entry.get("senses", []):
        for target in s.get("form_of", []):
            t = target.get("word", "")
            if WORD_RE.match(t) and t.lower() != word.lower():
                yield word.lower(), t.lower()


def build(entries: Iterable[dict], zipf: Zipf, max_lemmas: int = 40000, min_zipf: float = 1.5,
          built: str | None = None) -> dict:
    """The dictionary: the `max_lemmas` most common lemmas that have a meaning, and the forms that point at them."""
    lemmas: dict[str, tuple[str, str | None, str]] = {}
    links: list[tuple[str, str]] = []
    for e in entries:
        word = e.get("word", "")
        if e.get("pos") not in POS or not WORD_RE.match(word):
            continue
        links.extend(forms_of(e))
        if word[0].isupper():
            continue  # capitalised headwords are names and abbreviations
        m = meaning(e)
        if not m:
            continue
        key = word.lower()
        art = article(e)
        if key in lemmas:  # same word, another part of speech: add the meaning, keep the noun's article
            old_m, old_a, old_pos = lemmas[key]
            joined = old_m if m in old_m or len(old_m) + 2 + len(m) > 110 else f"{old_m}; {m}"
            lemmas[key] = (joined, old_a or art, old_pos)
        else:
            lemmas[key] = (m, art, e["pos"])

    freq = {w: zipf(w) for w in lemmas}
    # A word that is also a form of a more common lemma ("was" of zijn) is mostly read as that form, so its own
    # frequency overstates how often it means itself: it is ranked lower when choosing what to keep.
    shadowed = {form for form, lemma in links if form in lemmas and lemma in lemmas and form != lemma and zipf(lemma) >= freq[form]}
    rank = {w: freq[w] - (SHADOW_PENALTY if w in shadowed else 0) for w in lemmas}
    kept = sorted((w for w in lemmas if rank[w] >= min_zipf), key=lambda w: (-rank[w], w))[:max_lemmas]
    keep = set(kept)

    forms: dict[str, str] = {}
    for form, lemma in links:
        if lemma not in keep or form == lemma:
            continue
        f = zipf(form)
        if f < min_zipf:
            continue
        # A form that is also a word of its own ("was": zijn or wassen; "boeken": boek or boeken) goes to the more
        # common lemma, and only when that lemma is at least as common as the form itself.
        if form in keep and freq[lemma] < f:
            continue
        have = forms.get(form)
        if have is None or freq[lemma] > freq[have]:
            forms[form] = lemma

    return {
        "v": 1,
        "lang": "nl",
        "built": built or _dt.date.today().isoformat(),
        "attribution": ATTRIBUTION,
        # lemma -> [meaning, article or null, part of speech, zipf × 10]
        "lemmas": {w: [lemmas[w][0], lemmas[w][1], lemmas[w][2], round(freq[w] * 10)] for w in kept},
        "forms": dict(sorted(forms.items())),
    }


def wordfreq_zipf() -> Zipf:
    try:
        from wordfreq import zipf_frequency
    except ImportError as e:  # pragma: no cover - CI installs it
        raise SystemExit("The dictionary build needs wordfreq: pip install wordfreq") from e
    return lambda w: zipf_frequency(w, "nl")


def write(path: str, dictionary: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(dictionary, f, ensure_ascii=False, separators=(",", ":"))
