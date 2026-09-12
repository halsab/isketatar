"""Однократная подготовка WOFF2 из проверенных TTF; не зависимость CI."""
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import fontTools
from fontTools.ttLib import TTFont
from fontTools import subset
import uharfbuzz as hb

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
evidence = json.loads((root / "docs/production/font-evidence.json").read_text())
fixtures = json.loads((root / "docs/production/typography-fixtures.json").read_text())

def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)

texts = list(strings(fixtures))
for path in (root / "public/runtime").glob("*.json"):
    texts.extend(strings(json.loads(path.read_text())))
texts.extend(strings(json.loads((root / "src/ui/tt.json").read_text())))
arabic = sorted({run for text in texts for run in re.findall(r"[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff\u200c\u200d]+", text)})
cyrillic = {ord(c) for text in texts for c in text if '\u0400' <= c <= '\u052f'}

def shape(font, text, glyph_ids=None):
    buf = hb.Buffer()
    buf.add_str(text)
    buf.direction, buf.script, buf.language = "rtl", "Arab", "tt"
    hb.shape(font, buf)
    assert all(info.codepoint != 0 for info in buf.glyph_infos), text
    return [(glyph_ids[i.codepoint] if glyph_ids else i.codepoint, i.cluster, p.x_advance, p.y_advance, p.x_offset, p.y_offset)
            for i, p in zip(buf.glyph_infos, buf.glyph_positions)]

report = {"fonttools": fontTools.__version__, "harfbuzz": hb.version_string(), "fonts": []}
for entry in evidence["fonts"]:
    if not entry["selected_for_v1"]:
        continue
    raw = (source / entry["file"]).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == entry["sha256"], entry["file"]
    font = TTFont(io.BytesIO(raw), recalcTimestamp=False)
    original_order = font.getGlyphOrder()
    original_cmap = font.getBestCmap()
    # Поднабор сохраняет весь корпус; shaping сравнивается через исходные glyph IDs после перенумерации.
    keep = {ord(c) for text in texts for c in text if ord(c) in original_cmap}
    if entry["file"].startswith("Inter"):
        keep.update(set(range(0x20, 0x100)) | set(range(0x300, 0x370)) | {0x2116, 0x2212, 0x25cc, 0xfffd})
    else:
        keep.update(range(0x600, 0x700))
    options = subset.Options()
    options.recalc_timestamp = False
    cutter = subset.Subsetter(options=options)
    cutter.populate(unicodes=keep)
    cutter.subset(font)
    glyph_ids = [original_order.index(name) for name in font.getGlyphOrder()]
    font.flavor = "woff2"
    output = root / "src/assets/fonts" / entry["file"].replace(".ttf", ".woff2")
    font.save(output)
    restored = TTFont(output, recalcTimestamp=False)
    assert {point: restored.getGlyphID(name) for point, name in restored.getBestCmap().items()} == {point: font.getGlyphID(name) for point, name in font.getBestCmap().items()}
    restored.flavor = None
    sfnt = io.BytesIO()
    restored.save(sfnt)
    if entry["file"].startswith("Noto"):
        before, after = hb.Font(hb.Face(raw)), hb.Font(hb.Face(sfnt.getvalue()))
        for run in arabic:
            assert shape(before, run) == shape(after, run, glyph_ids), run
        checks = {"arabic_runs": len(arabic), "shape_identical": True, "subset": "Complete Arabic block and all corpus symbols", "retained_codepoints": len(restored.getBestCmap())}
    else:
        assert not cyrillic.difference(restored.getBestCmap())
        before, after = hb.Font(hb.Face(raw)), hb.Font(hb.Face(sfnt.getvalue()))
        runs = sorted({run for text in texts for run in re.findall(r"[\u0041-\u024f\u0400-\u052f]+", text)})
        for weight in [400, 500, 600, 700]:
            before.set_variations({'wght': weight})
            after.set_variations({'wght': weight})
            for run in runs:
                results = []
                for face, mapping in ((before, None), (after, glyph_ids)):
                    buf = hb.Buffer(); buf.add_str(run); buf.guess_segment_properties(); hb.shape(face, buf)
                    assert all(info.codepoint != 0 for info in buf.glyph_infos), run
                    results.append([(mapping[i.codepoint] if mapping else i.codepoint, i.cluster, p.x_advance, p.y_advance, p.x_offset, p.y_offset) for i, p in zip(buf.glyph_infos, buf.glyph_positions)])
                assert results[0] == results[1], (weight, run)
        checks = {"cyrillic_codepoints": len(cyrillic), "missing": [], "subset": "Corpus Latin/Cyrillic and symbols, ASCII/Latin-1 and combining marks", "checked_weights": [400, 500, 600, 700], "retained_codepoints": len(restored.getBestCmap()), "latin_cyrillic_runs": len(runs), "shape_identical": True}
    data = output.read_bytes()
    report["fonts"].append({"file": str(output.relative_to(root)), "source_sha256": entry["sha256"],
                            "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), **checks})
(root / "docs/development/font-build.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
