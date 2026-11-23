"""Write document paragraphs to stdout in reading order. Never unpack archive members to disk."""
import io
import sys
import zipfile
from xml.parsers import expat


WORD = {
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "http://purl.oclc.org/ooxml/wordprocessingml/main",
}


def extract(data):
    pieces = []
    count = 0
    active_text = False

    def append(value):
        nonlocal count
        count += len(value)
        if count > 100001:
            raise OverflowError()
        pieces.append(value)

    def word_tag(name):
        ns, _, tag = name.rpartition("|")
        return tag if ns in WORD else ""

    def start(name, attrs):
        nonlocal active_text
        tag = word_tag(name)
        if tag == "t":
            active_text = True
        elif tag == "tab":
            append("\t")
        elif tag in {"br", "cr"}:
            append("\n")

    def end(name):
        nonlocal active_text
        tag = word_tag(name)
        if tag == "t":
            active_text = False
        elif tag == "p":
            append("\n")

    def forbid_doctype(*args):
        raise ValueError("Unexpected DTD")

    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        info = archive.getinfo("word/document.xml")
        if info.file_size > 8_000_000 or info.flag_bits & 1:
            raise ValueError("Unsupported document member")
        parser = expat.ParserCreate(namespace_separator="|")
        parser.StartDoctypeDeclHandler = forbid_doctype
        parser.StartElementHandler = start
        parser.EndElementHandler = end
        parser.CharacterDataHandler = lambda value: append(value) if active_text else None
        with archive.open(info) as stream:
            parser.ParseFile(stream)
    return "".join(pieces).strip()


try:
    sys.stdout.buffer.write(extract(sys.stdin.buffer.read()).encode("utf-8"))
except OverflowError:
    sys.exit(3)
except (ValueError, KeyError, RuntimeError, OSError, expat.ExpatError, zipfile.BadZipFile):
    sys.exit(2)
