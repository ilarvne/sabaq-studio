"""Extract a deliberately limited set of editable PresentationML elements.

Run this script inside the same job sandbox as LibreOffice. ZIP member names
are used only for relationship lookups. All output names are generated here.
"""
import json
import math
import posixpath
import re
import shutil
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as XML
from xml.dom import minidom


NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}
STRICT = {
    "http://purl.oclc.org/ooxml/presentationml/main": NS["p"],
    "http://purl.oclc.org/ooxml/drawingml/main": NS["a"],
    "http://purl.oclc.org/ooxml/officeDocument/relationships": NS["r"],
    "http://purl.oclc.org/ooxml/drawingml/chart": NS["c"],
}
IGNORED = {"nvGrpSpPr", "grpSpPr", "extLst"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
NATIVE_SHAPES = {"rect": "rectangle", "ellipse": "ellipse", "rightArrow": "arrow"}
MAX_OBJECTS = 24  # Matches the editable slide object limit.


class NoDoctype(XML.TreeBuilder):
    def doctype(self, *_):
        raise ValueError("Unexpected DTD")


def read_xml(archive, name):
    entry = archive.getinfo(name)
    if entry.file_size > 2_000_000:
        raise ValueError("XML part is too large")
    parser = XML.XMLParser(target=NoDoctype())
    root = XML.fromstring(archive.read(entry), parser)
    for element in root.iter():
        if element.tag.startswith("{"):
            namespace, tag = element.tag[1:].split("}", 1)
            if namespace in STRICT:
                element.tag = f"{{{STRICT[namespace]}}}{tag}"
        for key, value in list(element.attrib.items()):
            strict_rel = "{http://purl.oclc.org/ooxml/officeDocument/relationships}"
            if key.startswith(strict_rel):
                element.attrib["{" + NS["r"] + "}" + key[len(strict_rel):]] = value
                del element.attrib[key]
    return root


def relationships(archive, source):
    folder, name = posixpath.split(source)
    part = posixpath.join(folder, "_rels", name + ".rels")
    try:
        root = read_xml(archive, part)
    except KeyError:
        return {}
    return {node.get("Id"): node for node in root.findall("pr:Relationship", NS)}


def target(source, relation, kind, directory):
    if relation is None or relation.get("TargetMode", "Internal") != "Internal":
        return None
    expected = {NS["r"] + "/" + kind, "http://purl.oclc.org/ooxml/officeDocument/relationships/" + kind}
    if relation.get("Type") not in expected:
        return None
    value = relation.get("Target", "")
    if not value or re.search(r"[\\%:#?\x00-\x1f]", value):
        return None
    candidate = posixpath.normpath(value[1:] if value.startswith("/") else posixpath.join(posixpath.dirname(source), value))
    return candidate if candidate.startswith(directory + "/") else None


def paragraphs(root):
    if root is None:
        return []
    result = []
    for paragraph in root.findall("a:p", NS):
        runs = []
        for node in paragraph:
            if node.tag == "{" + NS["a"] + "}br":
                runs.append({"text": "\n"})
                continue
            text = node.findtext("a:t", default="", namespaces=NS)
            if not text:
                continue
            style = node.find("a:rPr", NS)
            run = {"text": text}
            if style is not None:
                for attr, key in (("b", "bold"), ("i", "italic")):
                    if style.get(attr) in {"true", "1"}:
                        run[key] = True
            runs.append(run)
        result.append(runs)
    while result and not result[0]:
        result.pop(0)
    while result and not result[-1]:
        result.pop()
    return result


def plain(block):
    return "\n".join("".join(run["text"] for run in paragraph) for paragraph in block)


def title_placeholder(shape):
    placeholder = shape.find("p:nvSpPr/p:nvPr/p:ph", NS)
    return placeholder is not None and placeholder.get("type") in {"title", "ctrTitle"}


def position(shape):
    offset = shape.find("p:spPr/a:xfrm/a:off", NS)
    if offset is None:
        return (0, 0)
    return (int(offset.get("y", 0)), int(offset.get("x", 0)))


def compatible_text_shape(shape):
    transform = shape.find("p:spPr/a:xfrm", NS)
    if transform is not None and any(transform.get(key) not in (None, "0", "false") for key in ("rot", "flipH", "flipV")):
        return False
    properties = shape.find("p:spPr", NS)
    if properties is None:
        return True
    geometry = properties.find("a:prstGeom", NS)
    if geometry is not None and geometry.get("prst") != "rect":
        return False
    return all(properties.find("a:" + tag, NS) is None
               for tag in ("custGeom", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill", "effectLst"))


def speaker_notes(archive, source, links):
    part = next((name for link in links.values() if (name := target(source, link, "notesSlide", "ppt/notesSlides"))), None)
    if not part:
        return ""
    root = read_xml(archive, part)
    notes = []
    for shape in root.findall("p:cSld/p:spTree/p:sp", NS):
        placeholder = shape.find("p:nvSpPr/p:nvPr/p:ph", NS)
        if placeholder is None or placeholder.get("type", "body") == "body":
            value = plain(paragraphs(shape.find("p:txBody", NS))).strip()
            if value:
                notes.append(value)
    text = "\n".join(notes)
    if len(text) > 10_000:
        raise ValueError("Speaker notes exceed the editor limit")
    return text


def table_data(table):
    rows = []
    for row in table.findall("a:tr", NS):
        cells = row.findall("a:tc", NS)
        if any(any(key in cell.attrib for key in ("gridSpan", "rowSpan", "hMerge", "vMerge")) for cell in cells):
            return None
        rows.append([plain(paragraphs(cell.find("a:txBody", NS))) for cell in cells])
    if not rows or not 1 <= len(rows[0]) <= 30 or len(rows) > 101:
        return None
    if any(len(row) != len(rows[0]) for row in rows):
        return None
    lengths = [len(text) for row in rows for text in row]
    if max(lengths) > 1_000 or sum(lengths) > 10_000:
        return None
    return {"headers": rows[0], "rows": rows[1:]}


def cached_chart_points(cache):
    if cache is None:
        return None
    points = cache.findall("c:pt", NS)
    count = cache.find("c:ptCount", NS)
    if not 1 <= len(points) <= 100 or (count is not None and count.get("val") != str(len(points))):
        return None
    indexed = {point.get("idx"): (point.findtext("c:v", "", NS)).strip() for point in points}
    values = [indexed.get(str(i), "") for i in range(len(points))]
    return values if all(0 < len(value) <= 1000 for value in values) else None


def chart_data(archive, source, shape, links):
    chart = shape.find("a:graphic/a:graphicData/c:chart", NS)
    rel = chart.get("{" + NS["r"] + "}id") if chart is not None else None
    path = target(source, links.get(rel), "chart", "ppt/charts")
    if path is None:
        return None
    try:
        chart_part = read_xml(archive, path)
    except KeyError:
        return None
    plot = chart_part.find("c:chart/c:plotArea", NS)
    if plot is None:
        return None
    plots = [entry for entry in plot if entry.tag.endswith("Chart") or entry.tag.endswith("ChartEx")]
    if len(plots) != 1 or plots[0].tag != "{" + NS["c"] + "}barChart":
        return None
    column = plots[0]
    direction, grouping = column.find("c:barDir", NS), column.find("c:grouping", NS)
    if direction is None or direction.get("val") != "col" or (grouping is not None and grouping.get("val") != "clustered"):
        return None
    source_series = column.findall("c:ser", NS)
    if not 1 <= len(source_series) <= 12:
        return None
    categories, series = None, []
    for entry in source_series:
        cat = entry.find("c:cat/c:strRef/c:strCache", NS)
        if cat is None:
            multi = entry.find("c:cat/c:multiLvlStrRef/c:multiLvlStrCache", NS)
            levels = multi.findall("c:lvl", NS) if multi is not None else []
            cat = levels[0] if len(levels) == 1 else entry.find("c:cat/c:strLit", NS)
        labels = cached_chart_points(cat)
        value_cache = entry.find("c:val/c:numRef/c:numCache", NS)
        values = cached_chart_points(value_cache if value_cache is not None else entry.find("c:val/c:numLit", NS))
        name = entry.findtext("c:tx/c:v", "", NS).strip()
        if not name:
            names = cached_chart_points(entry.find("c:tx/c:strRef/c:strCache", NS))
            name = names[0] if names and len(names) == 1 else ""
        if not labels or not values or len(labels) != len(values) or not 0 < len(name) <= 1000:
            return None
        if categories is not None and categories != labels:
            return None
        try:
            numbers = [float(value) for value in values]
        except ValueError:
            return None
        if not all(math.isfinite(number) for number in numbers):
            return None
        categories = labels
        series.append({"name": name, "values": numbers})
    props = shape.find("p:nvGraphicFramePr/p:cNvPr", NS)
    alt = (props.get("descr", "") or props.get("title", "")).strip() if props is not None else ""
    if not alt:
        alt = "; ".join(item["name"] + ": " + ", ".join(f"{label} {value:.12g}"
                        for label, value in zip(categories[:5], item["values"][:5])) for item in series[:3])
    return {"categories": categories, "series": series, "alt": alt[:1000]}


def embedded_picture(archive, source, picture, links, width):
    blip = picture.find("p:blipFill/a:blip", NS)
    crop = picture.find("p:blipFill/a:srcRect", NS)
    props = picture.find("p:nvPicPr/p:cNvPr", NS)
    position_node = picture.find("p:spPr/a:xfrm", NS)
    if blip is None or list(blip) or crop is not None and any(int(v) != 0 for v in crop.attrib.values()):
        return None
    if position_node is not None and any(position_node.get(key) not in (None, "0", "false") for key in ("rot", "flipH", "flipV")):
        return None
    name = target(source, links.get(blip.get("{" + NS["r"] + "}embed")), "image", "ppt/media")
    if name is None or posixpath.splitext(name)[1].lower() not in IMAGE_SUFFIXES:
        return None
    entry = archive.getinfo(name)
    if entry.file_size > 10_000_000:
        return None
    x = position(picture)[1]
    return {"name": name, "alt": (props.get("descr", "") or props.get("title", ""))[:1000] if props is not None else "",
            "side": "left" if x < width // 2 else "right"}


def shape_bounds(shape):
    for path in ("p:spPr/a:xfrm", "p:xfrm", "p:grpSpPr/a:xfrm"):
        xfrm = shape.find(path, NS)
        if xfrm is None:
            continue
        if any(xfrm.get(k) not in (None, "0", "false") for k in ("rot", "flipH", "flipV")):
            return None
        offset, extent = xfrm.find("a:off", NS), xfrm.find("a:ext", NS)
        if offset is not None and extent is not None:
            x, y = int(offset.get("x", 0)), int(offset.get("y", 0))
            w, h = int(extent.get("cx", 0)), int(extent.get("cy", 0))
            if w > 0 and h > 0:
                return x, y, w, h
    if shape.tag == "{http://schemas.openxmlformats.org/markup-compatibility/2006}AlternateContent":
        # Different OOXML consumers may select different branches. Keep the union
        # of every explicitly positioned drawing when deciding possible occlusion.
        boxes = [shape_bounds(child) for branch in shape for child in branch]
        if boxes and all(box is not None for box in boxes):
            left, top = min(b[0] for b in boxes), min(b[1] for b in boxes)
            return left, top, max(b[0]+b[2] for b in boxes)-left, max(b[1]+b[3] for b in boxes)-top
    return None


def intersects(a, b):
    return a[0] < b[0]+b[2] and b[0] < a[0]+a[2] and a[1] < b[1]+b[3] and b[1] < a[1]+a[3]


def inside_slide(box, width, height):
    return box is not None and box[0] >= 0 and box[1] >= 0 and box[0]+box[2] <= width and box[1]+box[3] <= height


def solid_rgb(node):
    color = node.find("a:solidFill/a:srgbClr", NS)
    value = color.get("val", "") if color is not None else ""
    if re.fullmatch("[0-9A-Fa-f]{6}", value) and all(
        child.tag == "{" + NS["a"] + "}alpha" and child.get("val") == "100000" for child in color
    ):
        return "#" + value.upper()
    return None


def no_visible_line(properties):
    line = properties.find("a:ln", NS)
    if line is None or (not line.attrib and not len(line)) or line.find("a:noFill", NS) is not None:
        return True
    alpha = line.find("a:solidFill/a:srgbClr/a:alpha", NS)
    return alpha is not None and alpha.get("val") == "0"


def native_shape(shape):
    properties = shape.find("p:spPr", NS)
    if properties is None or shape.find("p:style", NS) is not None:
        return None
    geometry = properties.find("a:prstGeom", NS)
    kind = NATIVE_SHAPES.get(geometry.get("prst")) if geometry is not None else None
    allowed = {"xfrm", "prstGeom", "solidFill", "ln"}
    if not kind or geometry.findall("a:avLst/a:gd", NS) or not no_visible_line(properties) or any(
        child.tag.rsplit("}", 1)[-1] not in allowed for child in properties
    ):
        return None
    color = solid_rgb(properties)
    return {"kind": kind, "color": color} if color else None


def text_object(shape, block, box, scale):
    if box is None or shape.find("p:nvSpPr/p:nvPr/p:ph", NS) is not None:
        return None
    shape_properties = shape.find("p:spPr", NS)
    if shape_properties is not None and not no_visible_line(shape_properties):
        return None
    text = plain(block)
    if not text.strip() or len(text.encode("utf-16-le")) // 2 > 600:
        return None
    body = shape.find("p:txBody", NS)
    settings = body.find("a:bodyPr", NS)
    options = settings.attrib if settings is not None else {}
    if (options.get("anchor", "t") != "t" or options.get("vert", "horz") != "horz" or
        options.get("numCol", "1") != "1" or options.get("rot", "0") != "0" or options.get("rtlCol", "0") not in {"0", "false"}):
        return None
    if settings is not None and any(child.tag.rsplit("}", 1)[-1] != "noAutofit" for child in settings):
        return None
    try:
        inset = [int(options.get(key, default)) for key, default in (("lIns", "91440"), ("tIns", "45720"), ("rIns", "91440"), ("bIns", "45720"))]
    except ValueError:
        return None
    if min(inset) < 0:
        return None
    x, y, w, h = box
    box = (x+inset[0], y+inset[1], w-inset[0]-inset[2], h-inset[1]-inset[3])
    if min(box[2:]) <= 0:
        return None
    styles = set()
    for paragraph in body.findall("a:p", NS):
        properties = paragraph.find("a:pPr", NS)
        alignment = properties.get("algn", "l") if properties is not None else "l"
        if alignment not in {"l", "ctr", "r"} or (properties is not None and (
            any(properties.get(key, "0") != "0" for key in ("indent", "marL", "marR", "rtl")) or
            any(child.tag.rsplit("}", 1)[-1] not in {"buNone", "defRPr"} for child in properties)
        )):
            return None
        defaults = properties.find("a:defRPr", NS) if properties is not None else None
        for run in paragraph:
            kind = run.tag.rsplit("}", 1)[-1]
            if kind in {"pPr", "endParaRPr", "br"}:
                continue
            if kind != "r":
                return None
            style = run.find("a:rPr", NS)
            effective = {**(defaults.attrib if defaults is not None else {}), **(style.attrib if style is not None else {})}
            if any(effective.get(key) not in allowed for key, allowed in {
                "i": {None, "false", "0"}, "u": {None, "none"}, "strike": {None, "noStrike"},
                "baseline": {None, "0"}, "cap": {None, "none"}, "spc": {None, "0"},
            }.items()):
                return None
            try:
                font_size = round(int(effective.get("sz", "1800")) / 100 * scale * 6350)
            except (ValueError, OverflowError):
                return None
            if not 12 <= font_size <= 72:
                return None
            color = "#000000"
            for formatting in (defaults, style):
                if formatting is None:
                    continue
                if any(child.tag.rsplit("}", 1)[-1] not in {"solidFill", "latin", "ea", "cs"} for child in formatting):
                    return None
                if formatting.find("a:solidFill", NS) is not None:
                    color = solid_rgb(formatting)
                    if color is None:
                        return None
            styles.add((color, font_size, effective.get("b") in {"1", "true"}, alignment))
    if len(styles) != 1:
        return None
    color, font_size, bold, alignment = styles.pop()
    return {"kind": "text", "text": text, "color": color, "fontSize": font_size, "bold": bold,
            "align": {"l": "left", "ctr": "center", "r": "right"}[alignment]}, box


def extract_slide(archive, source, index, width, height):
    root = read_xml(archive, source)
    links = relationships(archive, source)
    tree = root.find("p:cSld/p:spTree", NS)
    if tree is None:
        raise ValueError("Invalid slide")
    blocks, native, drawings, artwork = [], [], [], []
    table = picture = chart = None
    scale = min(1920 / width, 1080 / height)
    left, top = max(0, (1920-width*scale)/2), max(0, (1080-height*scale)/2)

    def placed(box):
        x, y, w, h = box
        return {"x": (left+x*scale)/19.2, "y": (top+y*scale)/10.8, "w": w*scale/19.2, "h": h*scale/10.8, "rotation": 0}

    background = root.find("p:cSld/p:bg", NS)
    complex_background = background is not None and background.find("p:bgPr/a:solidFill", NS) is None
    for ordinal, shape in enumerate(tree):
        tag = shape.tag.rsplit("}", 1)[-1]
        if tag in IGNORED:
            continue
        box = shape_bounds(shape)
        if box is not None and not intersects(box, (0, 0, width, height)):
            continue
        if tag == "sp":
            block = paragraphs(shape.find("p:txBody", NS))
            if plain(block).strip():
                if compatible_text_shape(shape) and sum(len(p) for p in block) <= 1_000:
                    blocks.append((title_placeholder(shape), position(shape), block, ordinal, box, shape))
                    continue
            elif inside_slide(box, width, height) and (drawing := native_shape(shape)):
                drawings.append((ordinal, box, drawing))
                continue
        if tag == "graphicFrame":
            if table is None:
                candidate = shape.find("a:graphic/a:graphicData/a:tbl", NS)
                table = table_data(candidate) if candidate is not None else None
                if table is not None:
                    native.append(("table", ordinal, box))
                    continue
            if chart is None:
                chart = chart_data(archive, source, shape, links)
                if chart is not None:
                    native.append(("chart", ordinal, box))
                    continue
        if tag == "pic" and picture is None:
            picture = embedded_picture(archive, source, shape, links, width)
            if picture is not None:
                native.append(("image", ordinal, box))
                continue
        artwork.append((ordinal, box))

    blocks.sort(key=lambda item: (not item[0], *item[1]))
    title = blocks[0][2] if blocks else []
    body = blocks[1][2] if len(blocks) > 1 else []
    notes = speaker_notes(archive, source, links)
    fallback = {"editable": False, "notes": notes}
    if len(plain(title)) > 1000 or len(plain(body)) > 10_000:
        return fallback
    result = {"editable": True, "title": title, "body": body, "notes": notes}
    if complex_background or artwork or drawings or len(blocks) > 2 or chart is not None or (table is not None and picture is not None):
        if not blocks:
            return fallback
        native.extend(("title" if i == 0 else "body", obj[3], obj[4]) for i, obj in enumerate(blocks[:2]))
        if any(not inside_slide(box, width, height) for _, _, box in native):
            return fallback
        for _, _, block, order, box, shape in blocks[2:]:
            converted = text_object(shape, block, box, scale)
            if converted:
                drawing, content_box = converted
                drawings.append((order, content_box, drawing))
            else:
                artwork.append((order, box))
        objects, object_boxes = [], []
        for order, box, drawing in sorted(drawings, key=lambda item: item[0]):
            placement = placed(box)
            # Native objects are rendered above the title, body, table and image slots.
            # Leave a background shape in the raster when its original slot must stay above it.
            if (len(objects) == MAX_OBJECTS or not inside_slide(box, width, height) or min(placement["w"], placement["h"]) < 0.1 or
                any(z > order and intersects(box, bounds) for _, z, bounds in native)):
                artwork.append((order, box))
                continue
            objects.append({**drawing, **placement})
            object_boxes.append((order, box))
        # Baked artwork is always underneath the editable layers. Keep the original page
        # when a foreground graphic would otherwise stop covering an editable element.
        for order, box in [(z, bounds) for _, z, bounds in native] + object_boxes:
            if any(z > order and (other is None or intersects(box, other)) for z, other in artwork):
                return fallback
        result["positioned"] = [{"id": key, **placed(box)} for key, _, box in sorted(native, key=lambda item: item[1])]
        if objects:
            result["objects"] = objects
        result["mask"] = {"part": source, "ordinals": [z for _, z, _ in native] + [z for z, _ in object_boxes]}
    if table is not None:
        result["table"] = table
    if chart is not None:
        result["chart"] = chart
    if picture is not None:
        Path(f"editable-image-{index}.bin").write_bytes(archive.read(picture["name"]))
        result["picture"] = {"alt": picture["alt"], "side": picture["side"]}
    return result


def mask_selected_pages():
    slides = json.loads(Path("editable.json").read_text(encoding="utf-8"))
    selected = json.loads(Path("mask-pages.json").read_text(encoding="utf-8"))
    masks = {slides[i]["mask"]["part"]:set(slides[i]["mask"]["ordinals"]) for i in selected}
    with zipfile.ZipFile("source.pptx") as source, zipfile.ZipFile("masked.pptx","w",compression=zipfile.ZIP_DEFLATED) as dest:
        for info in source.infolist():
            if info.filename not in masks:
                with source.open(info) as inp, dest.open(info.filename,"w") as out:
                    shutil.copyfileobj(inp, out, length=64 * 1024)
                continue
            # read_xml already rejected DTDs and oversized parts on this immutable source.
            # minidom preserves original namespace prefixes, including markup-compatibility references.
            doc = minidom.parseString(source.read(info))
            trees = doc.getElementsByTagNameNS("*","spTree")
            if not trees:
                raise ValueError("Missing shape tree")
            tree = trees[0]
            children = [node for node in tree.childNodes if node.nodeType == node.ELEMENT_NODE]
            for ordinal in masks[info.filename]:
                tree.removeChild(children[ordinal]).unlink()
            dest.writestr(info.filename,doc.toxml(encoding="utf-8"))
            doc.unlink()


def extract():
    source = "ppt/presentation.xml"
    with zipfile.ZipFile("source.pptx") as archive:
        entries = archive.infolist()
        if (len(entries) > 4096 or len(set(archive.namelist())) != len(entries)
                or sum(entry.file_size for entry in entries) > 256_000_000
                or any(entry.flag_bits & 1 for entry in entries)):
            raise ValueError("Unsupported archive")
        root = read_xml(archive, source)
        slides = root.findall("p:sldIdLst/p:sldId", NS)
        size = root.find("p:sldSz", NS)
        width = int(size.get("cx", "12192000")) if size is not None else 12192000
        links = relationships(archive, source)
        height = int(size.get("cy", "6858000")) if size is not None else 6858000
        if not 1 <= len(slides) <= 40 or min(width,height) <= 0:
            raise ValueError("Unsupported slide count or size")
        paths = [target(source, links.get(slide.get("{" + NS["r"] + "}id")), "slide", "ppt/slides") for slide in slides]
        if None in paths or len(set(paths)) != len(paths):
            raise ValueError("Invalid slide relationships")
        result = [extract_slide(archive, name, index, width, height) for index, name in enumerate(paths, start=1)]
    Path("editable.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


def display_name(value, fallback):
    return (value or "").strip()[:100] or fallback


def template_master(archive, master, master_id):
    refs = relationships(archive, master)
    theme_path = next((part for rel in refs.values() if (part := target(master, rel, "theme", "ppt/theme"))), None)
    if not theme_path:
        return None
    theme = read_xml(archive, theme_path)
    scheme = theme.find("a:themeElements/a:clrScheme", NS)
    if scheme is None:
        return None
    colors = {}
    for entry in scheme:
        if len(entry):
            value = entry[0].get("lastClr") or entry[0].get("val", "")
            if re.fullmatch("[0-9a-fA-F]{6}", value):
                colors[entry.tag.rsplit("}", 1)[-1]] = "#" + value.upper()
    root = read_xml(archive, master)
    mapping = root.find("p:clrMap", NS)
    paper = colors.get(mapping.get("bg1", "lt1") if mapping is not None else "lt1", "#FFFFFF")
    ink = colors.get(mapping.get("tx1", "dk1") if mapping is not None else "dk1", "#000000")
    fill = root.find("p:cSld/p:bg/p:bgPr/a:solidFill", NS)
    if fill is not None and len(fill):
        val = fill[0].get("val", "")
        if re.fullmatch("[0-9a-fA-F]{6}", val):
            paper = "#" + val.upper()
        else:
            paper = colors.get(val, paper)

    def font(kind):
        entry = theme.find("a:themeElements/a:fontScheme/a:" + kind + "Font/a:latin", NS)
        name = entry.get("typeface", "").strip() if entry is not None else ""
        return name if name and len(name) <= 80 and all(c.isalnum() or c in " _.-" for c in name) else "Arial"

    layout_refs = root.findall("p:sldLayoutIdLst/p:sldLayoutId", NS)
    layout_links = [refs.get(ref.get("{" + NS["r"] + "}id")) for ref in layout_refs] if layout_refs else refs.values()
    paths = dict.fromkeys(part for link in layout_links if (part := target(master, link, "slideLayout", "ppt/slideLayouts")))
    layouts = []
    for index, path in enumerate(list(paths)[:32], 1):
        layout = read_xml(archive, path)
        content = layout.find("p:cSld", NS)
        kinds = [placeholder.get("type", "obj") for placeholder in layout.findall(".//p:ph", NS)]
        kind = layout.get("type", "")
        mapped = ("centered" if kind in ("title", "secHead", "titleOnly") or "ctrTitle" in kinds
                  else "split" if kind in ("twoObj", "twoTxTwoObj", "txAndObj", "objAndTx", "picTx") or sum(k in ("obj", "body", "pic") for k in kinds) >= 2
                  else "stacked")
        layouts.append({"id": f"{master_id}-l{index}", "masterId": master_id, "layout": mapped,
                        "name": display_name(content.get("name") if content is not None else None, kind or "Layout")})
    if not layouts:
        return None
    theme_name = display_name(theme.get("name") or scheme.get("name"), "PowerPoint")
    content = root.find("p:cSld", NS)
    visual = {"paper": paper, "ink": ink, "accent": colors.get("accent1", ink), "tint": colors.get("lt2", paper),
              "headingFont": font("major"), "bodyFont": font("minor")}
    master_name = display_name(content.get("name") if content is not None else None, theme_name)
    return {"id": master_id, "name": master_name, **visual}, {"name": theme_name, **visual}, layouts


def extract_template():
    source = "ppt/presentation.xml"
    with zipfile.ZipFile("source.pptx") as archive:
        entries = archive.infolist()
        if (len(entries) > 4096 or len(set(archive.namelist())) != len(entries)
                or sum(e.file_size for e in entries) > 256_000_000 or any(e.flag_bits & 1 for e in entries)):
            raise ValueError("Unsupported archive")
        root = read_xml(archive, source)
        links = relationships(archive, source)
        refs = root.findall("p:sldMasterIdLst/p:sldMasterId", NS)
        paths = dict.fromkeys(part for ref in refs
                              if (part := target(source, links.get(ref.get("{" + NS["r"] + "}id")), "slideMaster", "ppt/slideMasters")))
        groups = []
        for master in list(paths)[:16]:
            entry = template_master(archive, master, f"m{len(groups) + 1}")
            if entry:
                groups.append(entry)
        if not groups:
            raise ValueError("Missing usable slide masters")
        # Preserve presentation order while reserving at least one layout for each master.
        selected = []
        remaining = 32 - len(groups)
        for _, _, layouts in groups:
            count = min(len(layouts), 1 + remaining)
            selected.extend(layouts[:count])
            remaining -= count - 1
        style = {**groups[0][1], "masters": [group[0] for group in groups], "layouts": selected}
    Path("template.json").write_text(json.dumps(style, ensure_ascii=False), encoding="utf-8")


try:
    if "--mask" in sys.argv:
        mask_selected_pages()
    elif "--template" in sys.argv:
        extract_template()
    else:
        extract()
except (KeyError, ValueError, OverflowError, RuntimeError, OSError, XML.ParseError, zipfile.BadZipFile):
    sys.exit(2)
