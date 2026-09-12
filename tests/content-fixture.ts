import { loadSources, projectCorpus } from '../tools/content-build.mjs';
import { ContentCatalog } from '../src/domain/content/catalog';
import { validateCore, validateModule, validateReadings, validateDictionary, validateReferences, validateAssessments } from '../src/generated/content-validators.js';

export const projected = projectCorpus(await loadSources());
export function getTestCatalog(): ContentCatalog {
  if (!validateCore(projected.core)) throw new Error('Invalid core fixture');
  const catalog = new ContentCatalog(projected.core);
  for (const module of projected.modules) {
    if (!validateModule(module)) throw new Error('Invalid module fixture');
    catalog.addModule(module);
  }
  if (!validateReadings(projected.readings) || !validateDictionary(projected.dictionary) || !validateReferences(projected.references) || !validateAssessments(projected.assessments)) throw new Error('Invalid fixture');
  catalog.addReadings(projected.readings);
  catalog.addDictionary(projected.dictionary);
  catalog.addQuestions(projected.assessments);
  catalog.references = projected.references;
  return catalog;
}
