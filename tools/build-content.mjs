import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { loadSources, projectCorpus, digest } from './content-build.mjs';

const raw = await loadSources();
const sourceSchema = JSON.parse(await readFile('tools/schemas/source-corpus.json', 'utf8'));
const definitions = JSON.parse(await readFile('tools/schemas/runtime-content.json', 'utf8'));
const ajv = new Ajv({ strict: true, allErrors: true, code: { source: true, esm: true } });
if (!ajv.validate(sourceSchema, raw.sources)) throw new Error(`Invalid source schema: ${JSON.stringify(ajv.errors)}`);
const projected = projectCorpus(raw);
const exports = {};
for (const [name, schema] of Object.entries(definitions)) {
  ajv.addSchema(schema, name);
  const values = name === 'module' ? projected.modules : [projected[name]];
  for (const value of values) if (!ajv.validate(name, value)) throw new Error(`Invalid runtime ${name}: ${JSON.stringify(ajv.errors)}`);
  exports[`schema${name[0].toUpperCase()}${name.slice(1)}`] = name;
}
await mkdir('src/generated', { recursive: true });
const code = standaloneCode(ajv, exports)
  .replaceAll('require("ajv/dist/runtime/ucs2length").default', 'ucs2length')
  .replaceAll('require("ajv/dist/runtime/equal").default', 'equal');
if (code.includes('require(')) throw new Error('Unexpected standalone runtime helper');
const helpers = 'import lengthModule from "ajv/dist/runtime/ucs2length.js";\nimport equalModule from "ajv/dist/runtime/equal.js";\nconst ucs2length = typeof lengthModule === "function" ? lengthModule : lengthModule.default;\nconst equal = typeof equalModule === "function" ? equalModule : equalModule.default;\n';
const checks = Object.values(exports).map(name => `valid${name[0].toUpperCase()}${name.slice(1)}`);
const wrappers = Object.entries(exports).map(([schema, name]) => `export function validate${name[0].toUpperCase()}${name.slice(1)}(data) { return ${schema}(data) && valid${name[0].toUpperCase()}${name.slice(1)}(data); }`).join('\n');
const moduleCode = helpers + `import { ${checks.join(', ')} } from '../domain/content/validation.ts';\n` + code + '\n' + wrappers;
await writeFile('src/generated/content-validators.js', moduleCode);
const standalone = await import(`../src/generated/content-validators.js?${digest(moduleCode)}`);
for (const [name, validator] of Object.entries(exports)) {
  const values = validator === 'module' ? projected.modules : [projected[validator]];
  for (const value of values) if (!standalone[name.replace('schema', 'validate')](value)) throw new Error(`Standalone validation failed: ${name}`);
}
const resources = {
  'core.json': projected.core, 'readings.json': projected.readings, 'dictionary.json': projected.dictionary,
  'references.json': projected.references, 'assessments.json': projected.assessments,
  ...Object.fromEntries(projected.modules.map((module, index) => [`module-${projected.core.modules[index].id}.json`, module])),
};
await mkdir('public/runtime', { recursive: true });
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
await writeFile('public/runtime/content-manifest.json', JSON.stringify(contentManifest));
console.log(`Runtime catalog: ${projected.core.lessons.length} lessons, ${projected.core.questions.length} questions, ${assets.length} checked resources`);
