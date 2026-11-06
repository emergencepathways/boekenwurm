"""Split a paragraph into tokens the reader can tap.

Each token has a kind:
  word    countable, tappable, counts toward the checkpoint
  name    a person or place name (stays tappable for a note, never counts)
  number  digits, never counts
  punct   everything between words

Names are found per book: a capitalised word that is not at the start of a
sentence, and whose lowercase form never appears in the book, is a name.
Lemmas are the lowercase form for now; the spaCy step replaces them with
real base forms (liep -> lopen) once it is wired in.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass

TOKEN = re.compile(r"(?P<word>[^\W\d_]+(?:['’-][^\W\d_]+)*)|(?P<number>\d+(?:[.,:]\d+)*)|(?P<other>[^\w]+|_)", re.UNICODE)
SENTENCE_END = re.compile(r"[.!?…:]\s*[\"'“”‘’»)]*\s*$")


@dataclass
class Token:
    t: str  # text as written
    k: str  # "word" | "name" | "number" | "punct"
    s: int  # start offset
    e: int  # end offset
    lemma: str | None = None


def lowercase_vocabulary(texts: list[str]) -> set[str]:
    vocab: set[str] = set()
    for text in texts:
        for m in TOKEN.finditer(text):
            w = m.group("word")
            if w and w[0].islower():
                vocab.add(w.lower())
    return vocab


def tokenize(text: str, book_lowercase: set[str]) -> list[Token]:
    out: list[Token] = []
    sentence_start = True
    for m in TOKEN.finditer(text):
        s, e = m.span()
        if m.group("word"):
            w = m.group("word")
            is_name = w[0].isupper() and not sentence_start and w.lower() not in book_lowercase
            out.append(Token(w, "name" if is_name else "word", s, e, None if is_name else w.lower()))
            sentence_start = False
        elif m.group("number"):
            out.append(Token(m.group(), "number", s, e))
            sentence_start = False
        else:
            chunk = m.group()
            out.append(Token(chunk, "punct", s, e))
            if SENTENCE_END.search(chunk):
                sentence_start = True
    return out


def countable_lemmas(tokens: list[Token]) -> list[str]:
    return [t.lemma for t in tokens if t.k == "word" and t.lemma]


def to_json(tokens: list[Token]) -> list[dict]:
    return [{k: v for k, v in asdict(t).items() if v is not None} for t in tokens]
