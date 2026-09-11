#!/usr/bin/env python3
"""Собрать производные указатели без переписывания учебной теории."""

import hashlib
import json
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(path.read_text())


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def lookup_key(value):
    # Это поиск кандидатов для связи, не нормализация ответов ученика.
    return "".join(ch for ch in unicodedata.normalize("NFKC", value) if ch not in "ـ\u200c\u200d" and not ch.isspace())


def main():
    modules = [read(path) for path in sorted((ROOT / "content/lessons").glob("*.json"))]
    lexicon = read(ROOT / "content/lexicon/lexicon.json")["entries"]
    questions = [q for p in sorted((ROOT / "content/exercises").glob("*.json")) for q in read(p)["items"]]
    rules, vocabulary = [], []
    for module in modules:
        for lesson in module["lessons"]:
            for rule in lesson["rules"]:
                rules.append({"id": rule["id"], "lesson_id": lesson["id"], "module_id": module["module_id"], "source_sections": rule["source_sections"], "question_ids": [q["id"] for q in questions if rule["id"] in q["rule_ids"]]})
            if lesson["id"] in {"B01", "B02", "B03", "B04", "B05", "B06"}:
                continue
            for ex in lesson["examples"]:
                if not ex.get("reading_tt"):
                    continue
                matches = [w["id"] for w in lexicon if w["eligibility"]["tier"] == "active" and w.get("reading_tt") and w["reading_tt"].casefold() == ex["reading_tt"].casefold() and lookup_key(w["display_form"]) == lookup_key(ex["display_form"])]
                vocabulary.append({"id": "COURSE-" + ex["id"], "lesson_id": lesson["id"], "source_example_id": ex["id"], "display_form": ex["display_form"], "reading_tt": ex["reading_tt"], "meaning_tt": ex["meaning_tt"], "profile": ex["profile"], "source_lines": ex["source_lines"], "status": ex["status"], "kind": "phrase" if " " in ex["reading_tt"] else "word", "source_dictionary_ids": matches, "release": "with_lesson" if ex["usage"] == "demonstration" else "after_linked_question", "question_ids": [q["id"] for q in questions if ex["id"] in q["source_example_ids"]]})
    save(ROOT / "content/reference/rules-index.json", {"version": 1, "description_tt": "Кагыйдәнең тулы тексты тиешле дәрестә саклана.", "rules": rules})
    save(ROOT / "content/lexicon/course-vocabulary.json", {"version": 1, "description_tt": "Дәрес мисалларының укылышы һәм мәгънәсе. Бер үк сүзнең берничә уку очрагы саклана.", "entries": vocabulary})
    paths = ["content/curriculum.json", "content/skills.json", "content/interface/tt.json", "content/lexicon/lexicon.json", "content/lexicon/course-vocabulary.json", "content/media/manifest.json", "sources/sections.json"]
    for folder in ["lessons", "exercises", "reference", "assessment", "readings"]:
        paths.extend(str(p.relative_to(ROOT)) for p in sorted((ROOT / "content" / folder).glob("*.json")))
    assets = []
    for path in sorted(set(paths)):
        data = (ROOT / path).read_bytes()
        assets.append({"path": path, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "required": True})
    save(ROOT / "content/manifest.json", {"schema_version": 1, "content_version": "2026.09.11.1", "language": "tt", "assets": assets, "total_bytes": sum(a["bytes"] for a in assets), "editorial_only_paths": ["sources/textbook.txt", "sources/audits/", "content/source-coverage.json", "content/lexicon/source-historical.json", "content/lexicon/source-thematic.json", "content/lexicon/editorial-decisions.json", "content/lexicon/search-cases.json"], "note_tt": "Төп текст материалы тулысынча саклангач кына курс офлайн әзер дип күрсәтелә."})
    print(json.dumps({"rule_references": len(rules), "course_vocabulary_occurrences": len(vocabulary), "required_assets": len(assets), "required_bytes": sum(a["bytes"] for a in assets)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
