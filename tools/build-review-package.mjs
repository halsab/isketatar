import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadSources, projectCorpus } from './content-build.mjs';
import { productScope, sha256 } from './product-scope.mjs';
import assert from 'node:assert/strict';
import { verifyBuiltArtifact } from './release-artifact.mjs';

const output = 'quality-results/review-package';
const raw = await loadSources(); const corpus = projectCorpus(raw); const scope = await productScope();
const provenance = JSON.parse(await readFile('quality-results/build-provenance.json', 'utf8'));
assert.equal(provenance.product_scope_sha256, scope.sha256, 'Build final candidate before preparing review package');
await verifyBuiltArtifact('dist', provenance);
const copy = JSON.parse(await readFile('src/ui/tt.json', 'utf8'));
const supplementalUi = await Promise.all(['index.html', 'public/recovery.html', 'src/app/RecoveryBoundary.tsx', 'tools/build-release.mjs'].map(async path => ({
  path, context_review_required: true, source: await readFile(path, 'utf8'),
})));
const sources = await Promise.all(scope.files.filter(file => /^src\/.*\.[jt]sx?$/u.test(file.path)).map(async file => ({ path: file.path, lines: (await readFile(file.path, 'utf8')).split('\n') })));
const ui = Object.entries(copy).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, text_tt]) => {
  const uses = sources.flatMap(source => source.lines.flatMap((line, index) => line.includes(`'${key}'`) || line.includes(`"${key}"`) ? [{ path: source.path, line: index + 1, context: source.lines.slice(Math.max(0, index - 1), index + 2).join('\n') }] : []));
  return { key, text_tt, placeholders: [...new Set([...text_tt.matchAll(/\{([A-Za-z_][A-Za-z_0-9]*)\}/gu)].map(match => match[1]))].sort(), literal_uses: uses, context_review_required: true };
});
const lessons = corpus.modules.flatMap(module => module.lessons);
const questions = [...corpus.modules.flatMap(module => module.questions), ...corpus.readings.questions, ...corpus.assessments.questions];
const revisions = new Map(questions.map(question => [question.id, question.grading_revision]));
if (revisions.size !== questions.length || questions.length !== corpus.core.questions.length || corpus.core.questions.some(question => revisions.get(question.id) !== question.grading_revision)) throw new Error('Incomplete review question inventory');
const entities = [
  ...lessons.map(lesson => ({ kind: 'lesson', id: lesson.id, revision: lesson.content_revision, source_sections: lesson.source_sections })),
  ...lessons.flatMap(lesson => lesson.rules.map(rule => ({ kind: 'rule', id: rule.id, lesson_id: lesson.id, source_sections: rule.source_sections }))),
  ...lessons.flatMap(lesson => lesson.examples.map(example => ({ kind: 'example', id: example.id, lesson_id: lesson.id, source_lines: example.source_lines }))),
  ...questions.map(question => ({ kind: 'question', id: question.id, revision: question.grading_revision, lesson_id: question.lesson_id, source_lines: question.source_lines, source_example_ids: question.source_example_ids, rule_ids: question.rule_ids })),
  ...corpus.readings.readings.map(reading => ({ kind: 'reading', id: reading.id, revision: reading.content_revision, source_sections: reading.provenance.source_sections })),
  ...corpus.readings.readings.flatMap(reading => reading.lines.flatMap(line => [
    { kind: 'reading_line', id: line.id, reading_id: reading.id, revision: line.content_revision, source_lines: line.source_lines },
    ...line.words.map(word => ({ kind: 'reading_word', id: word.word_id, reading_id: reading.id, line_id: line.id, range: word.range, source_lines: line.source_lines })),
  ])),
  ...corpus.dictionary.entries.map(entry => ({ kind: 'dictionary', id: entry.id, source_lines: [entry.source.line, entry.source.line] })),
  ...corpus.dictionary.vocabulary.map(entry => ({ kind: 'vocabulary', id: entry.id, source_lines: entry.source_lines, source_example_ids: [entry.source_example_id] })),
  ...['letters', 'profiles', 'terms'].flatMap(kind => corpus.references[kind].map(entry => ({ kind, id: entry.id, ...(entry.source_sections ? { source_sections: entry.source_sections } : { lesson_id: entry.lesson_id }) }))),
];
const counts = { ui: ui.length, modules: corpus.modules.length, lessons: lessons.length, rules: lessons.reduce((n, lesson) => n + lesson.rules.length, 0), examples: lessons.reduce((n, lesson) => n + lesson.examples.length, 0), questions: questions.length, readings: corpus.readings.readings.length, dictionary_visible: corpus.dictionary.entries.length, course_vocabulary: corpus.dictionary.vocabulary.length };
const documents = {
  'scope.json': scope,
  'ui.json': ui,
  'ui-supplemental.json': supplementalUi,
  'corpus.json': corpus,
  'raw-sources.json': raw.sources,
  'entities.json': entities,
  'source-sections.json': JSON.parse(await readFile('sources/sections.json', 'utf8')),
};
await mkdir(output, { recursive: true });
const files = [];
for (const [path, value] of Object.entries(documents)) {
  const body = JSON.stringify(value, null, 2) + '\n'; await writeFile(`${output}/${path}`, body);
  files.push({ path, bytes: Buffer.byteLength(body), sha256: sha256(body) });
}
const textbook = await readFile('sources/textbook.txt');
await writeFile(`${output}/textbook.txt`, textbook);
files.push({ path: 'textbook.txt', bytes: textbook.length, sha256: sha256(textbook) });
const summary = { schema_version: 1, product_scope_sha256: scope.sha256, product_artifact_sha256: provenance.product_artifact_sha256, release_id: provenance.release_id, manifest_sha256: provenance.manifest_sha256, content_version: raw.manifest.content_version, counts, files,
  status: 'awaiting_external_review', limitations: ['Literal source references are navigation aids; dynamic keys and all UI states require contextual review.', 'Validated author keys are not independent subject approval.', 'No participants or physical-device results have been recorded.'] };
await writeFile(`${output}/manifest.json`, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ output, product_scope_sha256: scope.sha256, counts }, null, 2));
