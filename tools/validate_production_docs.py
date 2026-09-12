#!/usr/bin/env python3
"""Проверка спецификаций; не запускает приложение и не имитирует его grading."""

import argparse
import hashlib
import json
import math
import re
from pathlib import Path
from urllib.parse import unquote


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    production = root / 'docs/production'
    errors, counts = [], {}

    def check(condition, message):
        if not condition:
            errors.append(message)

    def pairs_unique(pairs):
        obj = {}
        for key, value in pairs:
            if key in obj:
                raise ValueError(f'duplicate JSON key: {key}')
            obj[key] = value
        return obj

    def read_json(path):
        try:
            return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=pairs_unique)
        except (ValueError, OSError) as exc:
            errors.append(f'{path.relative_to(root)}: {exc}')
            return {}

    def walk(value):
        yield value
        if isinstance(value, dict):
            for child in value.values():
                yield from walk(child)
        elif isinstance(value, list):
            for child in value:
                yield from walk(child)

    expected = ['00-plan', '01-architecture', '02-data-contracts', '03-learning-mechanics',
                '04-design-system', '05-routing', '06-screen-specs',
                '07-interaction-accessibility', '08-pwa-platforms',
                '09-security-reliability', '10-quality-release',
                '11-development-roadmap', '12-completion-audit']
    for name in expected:
        check((production / f'{name}.md').is_file(), f'missing document {name}')
    for name in ['PRODUCT.md', 'DESIGN.md', 'README.md']:
        check((root / name).is_file(), f'missing {name}')
    documents = list(production.glob('*.md')) + [root / n for n in ['PRODUCT.md', 'DESIGN.md', 'README.md']]
    link_count = 0
    for path in documents:
        # Примеры будущих путей в code fence не являются ссылками на текущие файлы.
        body = re.sub(r'```.*?```', '', path.read_text(), flags=re.S)
        for target in re.findall(r'\[[^\]\n]+\]\(([^)\n]+)\)', body):
            target = target.strip('<>')
            if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
                continue
            local = unquote(target.split('#', 1)[0])
            resolved = (path.parent / local).resolve()
            # Собственный отчёт создаётся этим же успешным запуском после проверки.
            is_report_output = args.report is not None and resolved == args.report.resolve()
            check(resolved.is_file() or is_report_output, f'{path.name}: broken link {target}')
            link_count += 1
    counts['markdown_documents'] = len(documents)
    counts['local_file_links'] = link_count

    loaded = {p.stem: read_json(p) for p in sorted(production.glob('*.json'))
              if p.name != 'validation-report.json'}
    counts['specification_json_files'] = len(loaded)
    manifest = read_json(root / 'content/manifest.json')
    corpus_objects, source_bytes = [], 0
    for asset in manifest.get('assets', []):
        path = root / asset['path']
        data = path.read_bytes()
        check(len(data) == asset['bytes'], f'content size mismatch: {asset["path"]}')
        check(hashlib.sha256(data).hexdigest() == asset['sha256'], f'content hash mismatch: {asset["path"]}')
        corpus_objects.append(read_json(path))
        source_bytes += len(data)
    check(source_bytes == manifest.get('total_bytes'), 'manifest total_bytes mismatch')
    counts['manifest_resources'] = len(corpus_objects)
    counts['manifest_bytes'] = source_bytes

    actual_ids = {v['id'] for obj in corpus_objects for v in walk(obj)
                  if isinstance(v, dict) and isinstance(v.get('id'), str)}
    identifier = re.compile(r'(?:Q-|D-|F-|RQ-|EX-|READ-|lex-|COURSE-|LETTER-|R-|TERM-|S-)[A-Za-z0-9_-]+')
    learning = loaded.get('learning-cases', {})
    case_ids = [c['id'] for c in learning.get('cases', [])]
    check(len(case_ids) == len(set(case_ids)) == 30, 'expected 30 unique learning cases')
    references = {v for v in walk(learning.get('cases', [])) if isinstance(v, str) and identifier.fullmatch(v)}
    for value in references:
        check(value in actual_ids, f'learning fixture unknown corpus ID: {value}')
    counts['learning_cases'] = len(case_ids)
    counts['distinct_fixture_content_ids'] = len(references)
    raw_answers = [v['answer_raw'] for v in walk(learning.get('cases', []))
                   if isinstance(v, dict) and 'answer_raw' in v]
    for answer in raw_answers:
        check(isinstance(answer, dict), 'answer_raw must be typed object')
        if not isinstance(answer, dict):
            continue
        kind = answer.get('kind')
        valid = kind in {'option', 'set', 'text', 'segments', 'unknown'}
        if kind == 'option':
            valid &= isinstance(answer.get('option_id'), str)
        elif kind == 'set':
            valid &= isinstance(answer.get('option_ids'), list)
        elif kind in {'text', 'segments'}:
            valid &= isinstance(answer.get('text'), str)
        check(valid, f'invalid AnswerValue fragment: {answer}')
    counts['typed_answer_fragments'] = len(raw_answers)

    copy = loaded.get('ui-copy-additions', {})
    base = read_json(root / 'content/interface/tt.json')['strings']
    additions, replacements = copy.get('additions', {}), copy.get('replacements', {})
    check(not (set(additions) & set(base)), 'UI additions collide with base')
    check(set(replacements) <= set(base), 'UI replacement missing base key')
    types = copy.get('placeholder_contract', {}).get('types', {})
    for key, value in {**additions, **replacements}.items():
        check(isinstance(value, str) and bool(value.strip()), f'empty/non-text UI copy: {key}')
        for placeholder in re.findall(r'\{(\w+)\}', value):
            check(placeholder in types, f'unknown placeholder {key}: {placeholder}')
        check(not re.search(r'<[^>]+>|[\x00-\x08\x0b\x0c\x0e-\x1f]', value), f'HTML/control in UI copy: {key}')
    counts.update(ui_base=len(base), ui_additions=len(additions), ui_replacements=len(replacements),
                  ui_merged=len(base) + len(additions))

    tokens = loaded.get('design-tokens', {})
    typography = loaded.get('typography-fixtures', {})
    fixture_ids = set()
    for case in typography.get('cases', []):
        check(case['id'] not in fixture_ids, f'duplicate typography fixture {case["id"]}')
        fixture_ids.add(case['id'])
        check([f'U+{ord(c):04X}' for c in case['text']] == case['codepoints'], f'codepoints differ: {case["id"]}')
    counts['typography_cases'] = len(fixture_ids)

    def luminance(hex_color):
        channels = [int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5)]
        linear = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in channels]
        return sum(c * w for c, w in zip(linear, (.2126, .7152, .0722)))

    contrast = loaded.get('contrast-report', {})
    for theme, colors in tokens.get('colors', {}).items():
        for name, color in colors.items():
            check(re.fullmatch(r'#[0-9A-F]{6}', color), f'invalid opaque token: {theme}/{name}')
            evidence = contrast['colors'][theme][name]
            check(evidence['hex'] == color, f'contrast token drift: {theme}/{name}')
            check(math.isclose(evidence['relative_luminance'], luminance(color), abs_tol=1e-12), f'luminance drift: {theme}/{name}')
    for pair in contrast.get('checks', []):
        colors = tokens['colors'][pair['theme']]
        a, b = colors[pair['foreground']], colors[pair['background']]
        x, y = sorted([luminance(a), luminance(b)])
        ratio = (y + .05) / (x + .05)
        check(a == pair['foreground_hex'] and b == pair['background_hex'], 'contrast pair hex drift')
        check(math.isclose(ratio, pair['ratio'], abs_tol=1e-10), 'contrast ratio drift')
        check(ratio >= pair['minimum'] and pair['pass'] is True, f'contrast failed: {pair}')
    counts['contrast_pairs'] = len(contrast.get('checks', []))
    fonts = loaded.get('font-evidence', {}).get('fonts', [])
    selected = [font for font in fonts if font.get('selected_for_v1')]
    for font in fonts:
        check(bool(re.fullmatch(r'[a-f0-9]{64}', font['sha256'])), f'font digest syntax: {font["file"]}')
        check(font['size'] > 0 and not font['missing'], f'font evidence incomplete: {font["file"]}')
    check(len(selected) == 2, 'expected two selected font families')
    counts['documented_font_files'] = len(fonts)
    counts['selected_fonts'] = len(selected)

    screen_text = (production / '06-screen-specs.md').read_text()
    screens = re.findall(r'^## (S\d\d)\.', screen_text, re.M)
    check(screens == [f'S{i:02}' for i in range(20)], 'screen index S00–S19 incomplete')
    counts['screens'] = len(screens)
    trace = loaded.get('requirements-traceability', {}).get('requirements', [])
    check([r['id'] for r in trace] == [f'R{i:02}' for i in range(1, 21)], 'R01–R20 traceability incomplete')
    for requirement in trace:
        check(bool(requirement.get('evidence')) and bool(requirement.get('review_conclusion')), f'empty evidence: {requirement["id"]}')
        for evidence in requirement['evidence']:
            check((root / evidence).is_file(), f'{requirement["id"]}: missing evidence {evidence}')
    counts['traced_requirements'] = len(trace)

    report = {
        'status': 'pass' if not errors else 'fail',
        'scope': 'Documentation structure, corpus hashes, passive fixtures, typography codepoints, palette arithmetic and requirement evidence paths.',
        'limitations': [
            'Does not execute application grading, IndexedDB, PWA or browser flows.',
            'Does not prove linguistic correctness, scientific review, rights or usability.',
            'Font files were inspected during design; this command checks recorded evidence, not fresh font shaping.',
            'Requirement meaning and cross-document consistency require the separate human-readable completion audit.',
            'Local file targets are checked; Markdown heading fragments and external URL availability are not revalidated.'
        ],
        'counts': counts,
        'errors': errors,
    }
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
