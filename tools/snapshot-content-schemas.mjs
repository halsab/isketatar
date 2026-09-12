import { writeFile } from 'node:fs/promises';
import { loadSources, projectCorpus } from './content-build.mjs';

// Снимок схем обновляется отдельной командой при принятом изменении контракта, не при обычной сборке.
function infer(values, closed, key = '') {
  const nonnull = values.filter(value => value !== null && value !== undefined);
  const kinds = [...new Set(nonnull.map(value => Array.isArray(value) ? 'array' : typeof value))];
  const schemas = kinds.map(kind => {
    const group = nonnull.filter(value => (Array.isArray(value) ? 'array' : typeof value) === kind);
    if (kind === 'object') {
      const keys = [...new Set(group.flatMap(Object.keys))].sort();
      return { type: 'object', properties: Object.fromEntries(keys.map(name => [name, infer(group.map(value => value[name]), closed, name)])), required: keys.filter(name => group.every(value => Object.hasOwn(value, name))), additionalProperties: !closed };
    }
    if (kind === 'array') {
      const items = group.flat();
      const schema = { type: 'array', items: items.length ? infer(items, closed, key) : { type: 'string' } };
      if (key === 'range' || key === 'source_lines') Object.assign(schema, { minItems: 2, maxItems: 2, items: { type: 'integer', minimum: key === 'range' ? 0 : 1 } });
      if (key.endsWith('_ids') || ['prerequisites', 'source_sections', 'skills'].includes(key)) schema.uniqueItems = true;
      return schema;
    }
    if (kind === 'number' && key === 'difficulty') return { type: 'integer', minimum: 1, maximum: 3 };
    if (kind === 'number') return { type: group.every(Number.isInteger) ? 'integer' : 'number', minimum: 0 };
    if (kind === 'boolean') return { type: 'boolean' };
    const schema = { type: 'string', maxLength: 20000 };
    if (key === 'id' || key.endsWith('_id')) Object.assign(schema, { minLength: 1, maxLength: 128 });
    if (key.endsWith('_revision') || key === 'visual' || key === 'reading') Object.assign(schema, { pattern: '^[a-f0-9]{64}$' });
    if (['type', 'grading', 'assessment_role', 'profile', 'release', 'usage', 'tier', 'origin', 'skill'].includes(key)) schema.enum = [...new Set(group)].sort();
    return schema;
  });
  if (values.includes(null)) schemas.push({ type: 'null' });
  return schemas.length === 1 ? schemas[0] : { anyOf: schemas };
}

const raw = await loadSources();
const projected = projectCorpus(raw);
await writeFile('tools/schemas/source-corpus.json', JSON.stringify(infer([raw.sources], false), null, 2) + '\n');
const questions = [...projected.modules.flatMap(module => module.questions), ...projected.readings.questions, ...projected.assessments.questions];
const question = infer(questions, true);
question.allOf = [{ oneOf: Object.entries({ choice: 'exact_option', select_many: 'set', reading: 'tt_reading', segment: 'segments' }).map(([type, grading]) => ({ properties: { type: { const: type }, grading: { const: grading }, ...(type === 'reading' || type === 'segment' ? { options: { type: 'array', maxItems: 0 }, accepted_answers: { type: 'array', minItems: 1 } } : { options: { type: 'array', minItems: 2 }, accepted_answers: { type: 'array', minItems: 1, ...(type === 'choice' ? { maxItems: 1 } : {}) } }) } })) }];
const definitions = {
  core: infer([projected.core], true),
  module: infer(projected.modules, true),
  readings: infer([projected.readings], true),
  dictionary: infer([projected.dictionary], true),
  references: infer([projected.references], true),
  assessments: infer([projected.assessments], true),
};
for (const name of ['module', 'readings', 'assessments']) definitions[name].properties.questions.items = question;
await writeFile('tools/schemas/runtime-content.json', JSON.stringify(definitions, null, 2) + '\n');
console.log('Content schema snapshots written; review before accepting changes.');
