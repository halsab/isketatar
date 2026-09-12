import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { loadSources, projectCorpus, digest } from './content-build.mjs';

const raw = await loadSources();
const sourceSchema = JSON.parse(await readFile('tools/schemas/source-corpus.json', 'utf8'));
const definitions = JSON.parse(await readFile('tools/schemas/runtime-content.json', 'utf8'));
const sourceAjv = new Ajv({ strict: true, allErrors: true });
if (!sourceAjv.validate(sourceSchema, raw.sources)) throw new Error(`Invalid source schema: ${JSON.stringify(sourceAjv.errors)}`);
const ajv = new Ajv({ strict: true, loopRequired: 3, loopEnum: 3, allErrors: false, messages: false, code: { source: true, esm: true, optimize: 2 }, inlineRefs: false });
const projected = projectCorpus(raw);
const exports = {};
for (const [name, schema] of Object.entries(definitions)) {
  ajv.addSchema(schema, name);
  const values = name === 'module' ? projected.modules : [projected[name]];
  for (const value of values) if (!ajv.validate(name, value)) throw new Error(`Invalid runtime ${name}: ${JSON.stringify(ajv.errors)}`);
  exports[`schema${name[0].toUpperCase()}${name.slice(1)}`] = name;
}
await mkdir('src/generated', { recursive: true });
const helpers = 'import lengthModule from "ajv/dist/runtime/ucs2length.js";\nimport equalModule from "ajv/dist/runtime/equal.js";\nconst ucs2length = typeof lengthModule === "function" ? lengthModule : lengthModule.default;\nconst equal = typeof equalModule === "function" ? equalModule : equalModule.default;\n';
const modules = [];
for (const [schema, name] of Object.entries(exports)) {
  const title = name[0].toUpperCase() + name.slice(1);
  const code = standaloneCode(ajv, { [schema]: name })
    .replaceAll('require("ajv/dist/runtime/ucs2length").default', 'ucs2length')
    .replaceAll('require("ajv/dist/runtime/equal").default', 'equal');
  if (code.includes('require(')) throw new Error('Unexpected standalone runtime helper');
  await writeFile(`src/generated/${name}-validator.js`, helpers + `import { valid${title} } from '../domain/content/validation.ts';\n` + code + `\nexport function validate${title}(data) { return ${schema}(data) && valid${title}(data); }\n`);
  modules.push(`export { validate${title} } from './${name}-validator.js';`);
}
const moduleCode = modules.join('\n') + '\n';
await writeFile('src/generated/content-validators.js', moduleCode);
const standalone = await import(`../src/generated/content-validators.js?${digest(moduleCode)}`);
for (const [name, validator] of Object.entries(exports)) {
  const values = validator === 'module' ? projected.modules : [projected[validator]];
  for (const value of values) if (!standalone[name.replace('schema', 'validate')](value)) throw new Error(`Standalone validation failed: ${name}`);
}
const resources = {
  'core.json': projected.core, 'readings.json': projected.readings,
  'dictionary-entries.json': { entries: projected.dictionary.entries, vocabulary: [] },
  'vocabulary.json': { entries: [], vocabulary: projected.dictionary.vocabulary },
  'references.json': projected.references, 'assessments.json': projected.assessments,
  ...Object.fromEntries(projected.modules.map((module, index) => [`module-${projected.core.modules[index].id}.json`, module])),
};
await mkdir('public/runtime', { recursive: true });
await rm('public/runtime/dictionary.json', { force: true });
for (const name of ['dictionary-entries.json', 'vocabulary.json']) if (!standalone.validateDictionary(resources[name])) throw new Error(`Invalid dictionary fragment: ${name}`);
await mkdir('public/sources', { recursive: true });
await copyFile('sources/sections.json', 'public/sources/sections.json');
const assets = [];
for (const [name, value] of Object.entries(resources)) {
  const bytes = Buffer.from(JSON.stringify(value));
  await writeFile(`public/runtime/${name}`, bytes);
  assets.push({ url: `/isketatar/runtime/${name}`, sha256: digest(bytes), bytes: bytes.length, kind: 'content', required: true });
}
const contentManifest = { content_version: raw.manifest.content_version, assets, question_revisions: Object.fromEntries(projected.core.questions.map(q => [q.id, q.grading_revision])), policy_versions: projected.core.policy_versions };
await writeFile('src/generated/content-manifest.json', JSON.stringify(contentManifest));
await writeFile('src/generated/content-index.json', JSON.stringify({ content_version: contentManifest.content_version, assets }));
await writeFile('public/runtime/content-manifest.json', JSON.stringify(contentManifest));
console.log(`Runtime catalog: ${projected.core.lessons.length} lessons, ${projected.core.questions.length} questions, ${assets.length} checked resources`);

await writeFile('src/generated/startup-resources.json', JSON.stringify(Object.fromEntries(projected.core.lessons.map(lesson => [lesson.id, lesson.resource]))));
