#!/usr/bin/env python3
"""Проверка целостности учебного комплекта; это не код приложения."""

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILES = {"book_jadid_10", "book_jadid_6", "book_kadimi", "book_yanga", "loan_original", "book_unspecified"}


def read(path):
    return json.loads((ROOT / path).read_text())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--partial", action="store_true", help="Проверить подготовленные модули до завершения комплекта")
    args = parser.parse_args()
    errors = []

    def check(condition, message):
        if not condition:
            errors.append(message)

    # splitlines также разделяет U+2028; адреса книги основаны только на LF.
    raw = (ROOT / "sources/textbook.txt").read_bytes()
    lines = raw.decode().split("\n")
    check(hashlib.sha256(raw).hexdigest() == "a3474bb9f43f2af3db5ee5711a4cb2b20fdd51eead5a0921569f8e847ac19efc", "Снимок источника изменён")
    sections = read("sources/sections.json")["sections"]
    section_ids = {s["id"] for s in sections}
    check(len(section_ids) == len(sections) == 114, "Неверный состав карты источника")
    check(all(a["line_end"] + 1 == b["line_start"] for a, b in zip(sections, sections[1:])), "Разрыв адресов источника")
    curriculum = read("content/curriculum.json")
    planned = {l["id"]: l for l in curriculum["lessons"]}
    check(len(planned) == 53, "Ожидается 53 урока")
    for route, order in curriculum["routes"].items():
        check(len(order) == len(set(order)), f"{route}: повтор урока")
        seen = set()
        for lid in order:
            check(lid in planned, f"{route}: неизвестный {lid}")
            if lid in planned:
                check(set(planned[lid]["prerequisites"]) <= seen, f"{route}/{lid}: нарушены зависимости")
            seen.add(lid)
    coverage = read("content/source-coverage.json")["sections"]
    check({s["source_section_id"] for s in coverage} == section_ids, "Неполное покрытие источника")
    for item in coverage:
        check(bool(item["lesson_ids"] or item.get("additional_destination")), f"Нет назначения {item}")
        check(set(item["lesson_ids"]) <= planned.keys(), f"Неизвестный урок в покрытии {item}")
    skills = read("content/skills.json")["skills"]
    check({x["lesson_id"] for x in skills} == planned.keys(), "Навыки не покрывают уроки")
    skill_ids = {x["id"] for x in skills}
    check(len(skill_ids) == len(skills), "Повтор навыка")
    for l in planned.values():
        check(bool(l["skills"]) and set(l["skills"]) <= skill_ids, f"{l['id']}: неверные навыки")

    lessons, rules, examples = {}, {}, {}

    def check_source(form, span, owner):
        check(isinstance(span, list) and len(span) == 2, f"{owner}: неверный диапазон")
        if not isinstance(span, list) or len(span) != 2:
            return
        lo, hi = span
        check(isinstance(lo, int) and isinstance(hi, int) and 1 <= lo <= hi <= len(lines), f"{owner}: адрес вне книги")
        if isinstance(lo, int) and isinstance(hi, int):
            check(bool(form) and form in "\n".join(lines[lo - 1:hi]), f"{owner}: source_form не найден в {span}: {form}")

    for path in sorted((ROOT / "content/lessons").glob("*.json")):
        module = json.loads(path.read_text())
        for l in module["lessons"]:
            lid = l["id"]
            check(lid not in lessons, f"Повтор урока {lid}")
            lessons[lid] = l
            check(lid in planned, f"Неизвестный урок {lid}")
            check(set(l["source_sections"]) <= section_ids, f"{lid}: неизвестный раздел")
            check(len(l.get("theory_tt", [])) >= 4 and all(l["theory_tt"]), f"{lid}: неполная теория")
            check(bool(l.get("goals_tt")) and bool(l.get("outcomes_tt")), f"{lid}: нет цели или результата")
            if lid in planned:
                check(l["prerequisites"] == planned[lid]["prerequisites"], f"{lid}: зависимости отличаются")
            for rule in l["rules"]:
                rid = rule["id"]
                check(rid not in rules, f"Повтор правила {rid}")
                rules[rid] = rule
                check(bool(rule["statement_tt"]) and bool(rule["scope_tt"]), f"{rid}: нет формулировки или границы")
                check(set(rule["source_sections"]) <= section_ids, f"{rid}: неизвестный источник")
            uses = Counter(ex.get("usage") for ex in l["examples"])
            check(uses["demonstration"] >= 4 and uses["assessment_source"] >= 2, f"{lid}: недостаточно раздельных примеров")
            for ex in l["examples"]:
                eid = ex["id"]
                check(eid not in examples, f"Повтор примера {eid}")
                examples[eid] = ex
                check(ex["profile"] in PROFILES, f"{eid}: неизвестный профиль")
                check(bool(ex["display_form"]) and bool(ex["explanation_tt"]), f"{eid}: неполный пример")
                check_source(ex["source_form"], ex["source_lines"], eid)

    questions = {}

    def check_question(q, reading=False):
        qid = q["id"]
        check(qid not in questions, f"Повтор вопроса {qid}")
        questions[qid] = q
        check(bool(q.get("prompt_tt")) and bool(q.get("explanation_tt")), f"{qid}: нет условия/объяснения")
        check(bool(q.get("accepted_answers")), f"{qid}: нет ключей")
        check(q.get("grading") in {"exact_option", "tt_reading", "set", "segments"}, f"{qid}: неизвестная проверка")
        options = q.get("options", [])
        oids = [o["id"] for o in options]
        check(len(oids) == len(set(oids)), f"{qid}: повтор ID опции")
        check(len({o["text_tt"] for o in options}) == len(options), f"{qid}: одинаковые опции")
        if q["grading"] in {"exact_option", "set"}:
            check(set(q["accepted_answers"]) <= set(oids), f"{qid}: ключ не является опцией")
        if q["grading"] == "exact_option":
            check(len(q["accepted_answers"]) == 1, f"{qid}: несколько ключей single choice")
        if not reading:
            check(q["lesson_id"] in lessons, f"{qid}: урок не подготовлен")
            check(set(q["rule_ids"]) <= rules.keys(), f"{qid}: неизвестное правило")
            check(set(q["source_example_ids"]) <= examples.keys(), f"{qid}: неизвестный пример")
            check(q["profile"] in PROFILES, f"{qid}: неизвестный профиль")
            if q["assessment_role"] == "transfer":
                refs = [examples[e] for e in q["source_example_ids"] if e in examples]
                check(any(e["usage"] == "assessment_source" for e in refs), f"{qid}: нет отдельного материала переноса")

    for path in sorted((ROOT / "content/exercises").glob("*.json")):
        for q in json.loads(path.read_text())["items"]:
            check_question(q)
    course_count = len(questions)
    course_questions = list(questions.values())
    practice_examples = {e for q in course_questions if q["assessment_role"] == "practice" for e in q["source_example_ids"]}
    for q in course_questions:
        if q["assessment_role"] == "transfer":
            check(not (set(q["source_example_ids"]) & practice_examples), f"{q['id']}: контрольный пример уже раскрыт в практике")
        expected = {"choice": "exact_option", "select_many": "set", "reading": "tt_reading", "segment": "segments"}
        check(expected.get(q["type"]) == q["grading"], f"{q['id']}: несовместимые type/grading")
        if q["grading"] == "segments":
            check(all("+" in a and all(p.strip() for p in a.split("+")) for a in q["accepted_answers"]), f"{q['id']}: неверный ключ разделения")
    by_lesson = Counter(q["lesson_id"] for q in questions.values())
    transfer = Counter(q["lesson_id"] for q in questions.values() if q["assessment_role"] == "transfer")
    for lid in lessons:
        if by_lesson[lid] or not args.partial:
            check(by_lesson[lid] >= 8 and transfer[lid] >= 2, f"{lid}: неполный банк заданий")
    if not args.partial:
        check(lessons.keys() == planned.keys(), "Подготовлены не все 53 урока")

    lexicon = read("content/lexicon/lexicon.json")["entries"]
    lexids = {x["id"] for x in lexicon}
    lexbyid = {x["id"]: x for x in lexicon}
    check(len(lexids) == len(lexicon) == 540, "Неполный исходниковый словарь")
    raw_ids = set()
    for filename, expected_count in [("source-thematic.json", 257), ("source-historical.json", 283)]:
        original = read("content/lexicon/" + filename)["entries"]
        check(len(original) == expected_count, f"{filename}: неверное число исходных записей")
        for entry in original:
            raw_ids.add(entry["id"])
            line = entry["source"].get("book_txt_line", entry["source"].get("book_txt_form_line"))
            check_source(entry["form_raw"], [line, line], entry["id"])
            if entry["id"] in lexbyid:
                check(lexbyid[entry["id"]]["source_form"] == entry["form_raw"], f"{entry['id']}: исходная словарная форма изменена")
    check(raw_ids == lexids, "Состав словаря отличается от всех исходных записей")
    for word in lexicon:
        check(bool(word["meaning_tt"]), f"{word['id']}: нет татарского значения")
        tier = word["eligibility"]["tier"]
        check(tier in {"active", "reference", "archive"}, f"{word['id']}: неизвестный допуск")
        if word["eligibility"]["practice_allowed"]:
            check(tier == "active" and bool(word["reading_tt"]), f"{word['id']}: неподтверждённое чтение в практике")
        if tier == "archive":
            check(not word["eligibility"]["dictionary_visible"] and bool(word["eligibility"]["reason_tt"]), f"{word['id']}: неверный архив")

    readings = {}
    path = ROOT / "content/readings/texts.json"
    if path.exists():
        readings = {r["id"]: r for r in json.loads(path.read_text())["texts"]}
        for r in readings.values():
            check(bool(r["instructions_tt"]) and len(r["lines"]) >= 2, f"{r['id']}: неполное чтение")
            for line in r["lines"]:
                check_source(line["source_form"], line["source_lines"], line["id"])
                check(bool(line["reading_tt"]) and bool(line["meaning_tt"]), f"{line['id']}: нет чтения/смысла")
                for word in line["words"]:
                    check(word.get("lexicon_id") is None or word["lexicon_id"] in lexids, f"{line['id']}: неизвестное слово")
                    check(word["surface"] in line["display_form"], f"{line['id']}: фрагмент слова отсутствует в строке")
                    if word.get("lexicon_id") in lexbyid:
                        check(lexbyid[word["lexicon_id"]]["eligibility"]["dictionary_visible"], f"{line['id']}: архивная словарная подсказка")
    path = ROOT / "content/readings/questions.json"
    if path.exists():
        for q in json.loads(path.read_text())["items"]:
            check_question(q, reading=True)
            rid = q["source_reading_id"]
            check(rid in readings, f"{q['id']}: неизвестный текст")
            if rid in readings:
                check(set(q["line_ids"]) <= {l["id"] for l in readings[rid]["lines"]}, f"{q['id']}: неизвестная строка")
    for r in readings.values():
        check(set(r["question_ids"]) <= questions.keys(), f"{r['id']}: отсутствуют вопросы")
        if r["role"] == "final":
            demo = [e["display_form"] for e in examples.values() if e["usage"] == "demonstration"]
            practice = [q["stimulus"] for q in course_questions if q["assessment_role"] == "practice"]
            for line in r["lines"]:
                check(line["display_form"] not in demo + practice, f"{r['id']}: итоговая строка раскрыта заранее")

    for name in ["diagnostic", "final"]:
        path = ROOT / f"content/assessment/{name}.json"
        if path.exists():
            assessment = json.loads(path.read_text())
            for q in assessment["items"]:
                check_question(q, reading=True)
                check_source(q["source_form"], q["source_lines"], q["id"])
                check(set(q["recommend_lessons"]) <= planned.keys(), f"{q['id']}: неизвестный рекомендованный урок")
            if name == "diagnostic":
                ids = {q["id"] for q in assessment["items"]}
                check(len(ids) == 18, "Неполная диагностика")
                for group in assessment["groups"].values():
                    check(set(group["question_ids"]) <= ids, "Неизвестный ID группы диагностики")
            else:
                final_rids = set(assessment["reading_text_ids"])
                finals = [q for q in questions.values() if q.get("source_reading_id") in final_rids and q["assessment_role"] == "final"]
                check(len(assessment["items"]) == 16 and len(finals) == 4, "Итог не содержит 16 + 4 вопроса")
                check(all(q.get("group") == assessment["rubric"]["reading_group"] for q in finals), "Не назначена итоговая группа чтения")

    path = ROOT / "content/media/manifest.json"
    if path.exists():
        media = json.loads(path.read_text())
        for asset in media["required_text_assets"]:
            check((ROOT / asset["path"]).is_file(), f"Обязательный ресурс отсутствует: {asset['path']}")
        for audio in media["optional_audio"]:
            rid = audio["source_reading_id"]
            check(rid in readings, f"{audio['id']}: неизвестный источник аудио")
            if rid in readings:
                check(audio["spoken_tt"] == "\n".join(l["reading_tt"] for l in readings[rid]["lines"]), f"{audio['id']}: сценарий не совпадает с чтением")
            if not audio.get("asset_path"):
                check(not audio["ui_available"] and not audio["required"], f"{audio['id']}: отсутствующее аудио требуется интерфейсу")

    path = ROOT / "content/reference/rules-index.json"
    if path.exists():
        index = json.loads(path.read_text())["rules"]
        check({r["id"] for r in index} == rules.keys(), "Указатель правил устарел")
        for r in index:
            check(set(r["question_ids"]) <= questions.keys(), f"{r['id']}: неизвестный вопрос указателя")
            check(bool(r["question_ids"]), f"{r['id']}: у правила нет задания")
    path = ROOT / "content/lexicon/course-vocabulary.json"
    if path.exists():
        for word in json.loads(path.read_text())["entries"]:
            check(word["source_example_id"] in examples, f"{word['id']}: отсутствует пример")
            check(set(word["source_dictionary_ids"]) <= lexids, f"{word['id']}: неизвестная словарная связь")
            check(set(word["question_ids"]) <= questions.keys(), f"{word['id']}: неизвестный вопрос")
    letters = read("content/reference/letters.json")["letters"]
    check(len(letters) == len({l["base"] for l in letters}) == 34, "Неполный основной алфавит")
    check(sum(not l["joins_following"] for l in letters) == 8, "Неверная группа несоединяющихся букв")
    path = ROOT / "content/manifest.json"
    if path.exists():
        manifest = json.loads(path.read_text())
        total = 0
        for asset in manifest["assets"]:
            path = ROOT / asset["path"]
            check(path.is_file(), f"Ресурс манифеста отсутствует: {asset['path']}")
            if path.is_file():
                blob = path.read_bytes()
                total += len(blob)
                check(asset["bytes"] == len(blob) and asset["sha256"] == hashlib.sha256(blob).hexdigest(), f"Манифест устарел: {asset['path']}")
        check(total == manifest["total_bytes"], "Неверный общий размер манифеста")
    if not args.partial:
        check(len(readings) >= 12 and sum(r["role"] == "final" for r in readings.values()) >= 2, "Неполный комплект чтения")
        for required in ["content/assessment/diagnostic.json", "content/assessment/final.json", "content/reference/rules-index.json", "content/lexicon/course-vocabulary.json", "content/media/manifest.json", "docs/09-completion-audit.md"]:
            check((ROOT / required).exists(), f"Нет обязательного файла {required}")

    for path in (ROOT / "content").rglob("*.json"):
        text = path.read_text()
        check(not re.search(r"\b(?:TODO|TBD|FIXME)\b", text), f"{path.relative_to(ROOT)}: незавершённая пометка")
    summary = {"lessons": len(lessons), "rules": len(rules), "examples": len(examples), "course_questions": course_count, "source_dictionary_records": len(lexicon), "readings": len(readings), "errors": len(errors), "mode": "partial" if args.partial else "complete"}
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    for error in errors:
        print("ERROR:", error)
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
