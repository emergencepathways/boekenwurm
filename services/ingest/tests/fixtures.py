"""Synthetic test books. Every sentence here is written for the tests; no real book text."""
from __future__ import annotations

import os
import tempfile
import zipfile

MODERN_NL = [
    "Op zaterdag gaat Sanne met de fiets naar de markt in het centrum van de stad.",
    "Ze koopt kaas, brood en een bos bloemen voor haar moeder, want die is morgen jarig.",
    "Bij het kraampje met vis staat een lange rij, dus ze wacht even en drinkt een kop koffie.",
    "Daarna fietst ze terug naar huis, omdat het begint te regenen en ze geen jas bij zich heeft.",
    "Thuis zet ze de bloemen in een vaas en maakt ze een lekkere lunch voor zichzelf en haar huisgenoot.",
    "In de middag belt haar broer om te vragen of ze zondag samen naar het strand willen gaan.",
    "Sanne zegt dat het een goed plan is, maar alleen als het weer niet te koud wordt.",
]
OLD_NL = [
    "Zoo zat de oude man bij het venster en keek met groote oogen naar de menschen op straat.",
    "Hij had eene brief ontvangen, doch hij wist niet goed wat hij er thans mede moest doen.",
    "Tusschen de boomen liepen de kinderen, en zij zongen een liedje, zooals zij altijd deden.",
    "Het oogenblik daarna zeide zijne vrouw dat de visch op tafel stond en dat het vleesch koud werd.",
    "Zoo gingen de dagen voorbij, en de oude man bleef wachten op een antwoord van zijne zoon.",
    "Eenige weken later kwam er eindelijk eene tweede brief, maar ook die bracht geen goed nieuws.",
]
ENGLISH = [
    "In this chapter you will learn how to order food and drinks in a Dutch café with confidence.",
    "Remember that the word order changes when the sentence starts with a time expression like today.",
    "The following exercises are designed to help you practise the vocabulary from the previous lesson.",
    "Try to read each example out loud, and pay attention to the pronunciation of the long vowels.",
]
MIXED = [
    "Ik wil graag een kop koffie met melk. (I would like a cup of coffee with milk, please.)",
    "Waar is het station? Het is daar, naast de bank. (Where is the station? It is there, next to the bank.)",
]


def make_epub(paragraphs: list[str], *, title="Testboek", lang="nl", dates=(), identifier="urn:uuid:test",
              source="", front_matter=(), directory: str | None = None) -> str:
    directory = directory or tempfile.mkdtemp(prefix="boekenwurm-test-")
    path = os.path.join(directory, f"{title.replace(' ', '_')}.epub")
    date_xml = "".join(
        f'<dc:date opf:event="{ev}">{v}</dc:date>' if ev else f"<dc:date>{v}</dc:date>" for v, ev in dates
    )
    opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
 <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>{title}</dc:title><dc:creator>Test Auteur</dc:creator><dc:language>{lang}</dc:language>
  <dc:identifier id="id">{identifier}</dc:identifier>{f'<dc:source>{source}</dc:source>' if source else ''}{date_xml}
 </metadata>
 <manifest>
  <item id="front" href="front.xhtml" media-type="application/xhtml+xml"/>
  <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
  <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
 </manifest>
 <spine><itemref idref="nav"/><itemref idref="front"/><itemref idref="ch1"/></spine>
</package>"""

    def xhtml(body):
        return f'<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{{}}</style></head><body>{body}</body></html>'

    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr("META-INF/container.xml",
                   '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                   '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        z.writestr("OEBPS/content.opf", opf)
        z.writestr("OEBPS/nav.xhtml", xhtml("<nav><ol><li>Inhoud van het boek met hoofdstukken</li></ol></nav>"))
        z.writestr("OEBPS/front.xhtml", xhtml("".join(f"<p>{t}</p>" for t in front_matter)))
        z.writestr("OEBPS/text/ch1.xhtml", xhtml("<h1>Hoofdstuk een</h1>" + "".join(f"<p>{t}</p>" for t in paragraphs)))
    return path
