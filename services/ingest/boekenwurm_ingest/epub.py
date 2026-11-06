"""Read an EPUB into metadata plus an ordered list of text blocks.

Standard library only. Blocks are the reader's paragraphs: <p>, <li>,
<blockquote>, <dd> and headings, in spine (reading) order. Navigation
documents are skipped.
"""
from __future__ import annotations

import posixpath
import re
import zipfile
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import unquote
from xml.etree import ElementTree as ET

NS = {
    "c": "urn:oasis:names:tc:opendocument:xmlns:container",
    "opf": "http://www.idpf.org/2007/opf",
    "dc": "http://purl.org/dc/elements/1.1/",
}
BLOCK_TAGS = {"p", "li", "blockquote", "dd", "h1", "h2", "h3", "h4", "h5", "h6"}
HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
SKIP_TAGS = {"script", "style", "head", "title"}


@dataclass
class DateEntry:
    value: str
    event: str = ""  # EPUB 2 opf:event ("publication", "original-publication", "modification"...)


@dataclass
class Metadata:
    title: str = ""
    creators: list[str] = field(default_factory=list)
    languages: list[str] = field(default_factory=list)
    dates: list[DateEntry] = field(default_factory=list)
    identifiers: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    publisher: str = ""
    modified: str = ""  # EPUB 3 dcterms:modified


@dataclass
class Block:
    index: int
    doc: int  # position of the source document in the spine
    tag: str
    text: str

    @property
    def is_heading(self) -> bool:
        return self.tag in HEADINGS


@dataclass
class Book:
    path: str
    meta: Metadata
    blocks: list[Block]


class _Blocks(HTMLParser):
    """Collect block-level text; nested blocks (li inside li) flush the outer one first."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[tuple[str, str]] = []
        self._stack: list[tuple[str, list[str]]] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TAGS:
            self._skip += 1
        elif tag in BLOCK_TAGS:
            self._flush_top()
            self._stack.append((tag, []))
        elif tag == "br" and self._stack:
            self._stack[-1][1].append(" ")

    def handle_startendtag(self, tag, attrs):
        if tag == "br" and self._stack:
            self._stack[-1][1].append(" ")

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
        elif tag in BLOCK_TAGS and self._stack:
            while self._stack:
                t, buf = self._stack.pop()
                self._emit(t, buf)
                if t == tag:
                    break

    def handle_data(self, data):
        if not self._skip and self._stack:
            self._stack[-1][1].append(data)

    def close(self):
        super().close()
        while self._stack:
            t, buf = self._stack.pop()
            self._emit(t, buf)

    def _flush_top(self):
        if self._stack:
            t, buf = self._stack[-1]
            self._emit(t, buf)
            buf.clear()

    def _emit(self, tag, buf):
        text = re.sub(r"\s+", " ", "".join(buf)).strip()
        if text:
            self.out.append((tag, text))


def _text(el) -> str:
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip() if el is not None else ""


def read_epub(path: str) -> Book:
    with zipfile.ZipFile(path) as z:
        container = ET.fromstring(z.read("META-INF/container.xml"))
        rootfile = container.find(".//c:rootfile", NS)
        if rootfile is None:
            raise ValueError("EPUB has no rootfile in META-INF/container.xml")
        opf_path = rootfile.attrib["full-path"]
        opf = ET.fromstring(z.read(opf_path))
        base = posixpath.dirname(opf_path)

        md = opf.find("opf:metadata", NS)
        meta = Metadata()
        if md is not None:
            meta.title = _text(md.find("dc:title", NS))
            meta.creators = [_text(e) for e in md.findall("dc:creator", NS) if _text(e)]
            meta.languages = [_text(e) for e in md.findall("dc:language", NS) if _text(e)]
            meta.identifiers = [_text(e) for e in md.findall("dc:identifier", NS) if _text(e)]
            meta.sources = [_text(e) for e in md.findall("dc:source", NS) if _text(e)]
            meta.publisher = _text(md.find("dc:publisher", NS))
            for e in md.findall("dc:date", NS):
                event = e.attrib.get(f"{{{NS['opf']}}}event", "")
                if _text(e):
                    meta.dates.append(DateEntry(_text(e), event))
            for e in md.findall("opf:meta", NS):
                if e.attrib.get("property") == "dcterms:modified":
                    meta.modified = _text(e)

        manifest = {}
        for item in opf.iterfind("opf:manifest/opf:item", NS):
            manifest[item.attrib.get("id")] = item.attrib
        spine = [r.attrib.get("idref") for r in opf.iterfind("opf:spine/opf:itemref", NS)]

        blocks: list[Block] = []
        for doc_i, idref in enumerate(spine):
            item = manifest.get(idref)
            if not item or "nav" in item.get("properties", "").split():
                continue
            if "html" not in item.get("media-type", ""):
                continue
            href = posixpath.normpath(posixpath.join(base, unquote(item["href"])))
            try:
                raw = z.read(href).decode("utf-8", "replace")
            except KeyError:
                continue
            parser = _Blocks()
            parser.feed(raw)
            parser.close()
            for tag, text in parser.out:
                blocks.append(Block(len(blocks), doc_i, tag, text))
    return Book(path, meta, blocks)
